begin;

-- Custody means physically at RUAH. Allocations remain in custody while
-- reserved or shipping; post_shipment changes them to shipped and is the
-- existing, unique boundary that removes them from this view.
drop function public.customer_custody();
create function public.customer_custody()
returns table(
  allocation_id uuid, perfume_id uuid, perfume_name text,
  quantity_ml numeric, sale_date date, allocation_status text,
  requested boolean, request_id uuid
)
language sql stable security definer set search_path = public as $$
  select a.id, a.perfume_id, p.full_name_raw, a.quantity_ml, s.sale_date,
    a.status::text, (i.id is not null), i.request_id
  from public.inventory_allocations a
  join public.perfumes p on p.id = a.perfume_id
  join public.sales s on s.id = a.sale_id
  left join public.customer_shipment_request_items i
    on i.allocation_id = a.id
   and i.request_id in (
     select id from public.customer_shipment_requests where status <> 'cancelled'
   )
  where a.client_id = public.current_customer_client()
    and a.status in ('reserved', 'shipping')
  order by p.full_name_raw, s.sale_date;
$$;
revoke all on function public.customer_custody() from public, anon;
grant execute on function public.customer_custody() to authenticated;

-- Add the allocation identity to the already-private request payload so the
-- portal can correlate a perfume/allocation with its customer-facing stage.
drop function public.customer_shipment_requests_list();
create function public.customer_shipment_requests_list()
returns table(
  request_id uuid, status text, requested_at timestamptz, cancelled_at timestamptz,
  items jsonb, converted_shipment_id uuid, shipment_status public.shipment_status,
  awaiting_approval boolean, shipping_price numeric, carrier text, service text,
  selected_quote_id uuid, customer_approved_at timestamptz,
  tracking_code text, posted_at timestamptz, delivered_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.requested_at, r.cancelled_at,
    (select jsonb_agg(jsonb_build_object(
       'allocation_id', i.allocation_id,
       'perfume_id', i.perfume_id,
       'perfume', p.full_name_raw,
       'quantity_ml', i.quantity_ml
     ))
     from public.customer_shipment_request_items i
     join public.perfumes p on p.id = i.perfume_id
     where i.request_id = r.id),
    r.converted_shipment_id, sh.status, (sh.status = 'awaiting_customer_approval'),
    sh.shipping_price, sh.carrier, sh.service, sh.selected_quote_id, sh.customer_approved_at,
    sh.tracking_code, sh.posted_at, sh.delivered_at
  from public.customer_shipment_requests r
  left join public.shipments sh
    on sh.id = r.converted_shipment_id
   and sh.client_id = r.client_id
   and sh.organization_id = r.organization_id
  where r.client_id = public.current_customer_client()
  order by r.requested_at desc;
$$;
revoke all on function public.customer_shipment_requests_list() from public, anon;
grant execute on function public.customer_shipment_requests_list() to authenticated;

-- Shared transactional cancellation. It is intentionally not executable by
-- authenticated callers directly; the customer and staff wrappers below
-- establish ownership/authorization first.
create or replace function public.customer_shipment_request_cancel_core(
  p_request_id uuid, p_client_id uuid, p_actor_id uuid
)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare
  v_request public.customer_shipment_requests;
  v_shipment public.shipments;
begin
  select * into v_request
  from public.customer_shipment_requests
  where id = p_request_id and client_id = p_client_id
  for update;
  if v_request.id is null then raise exception 'request_not_found'; end if;
  if v_request.status = 'cancelled' then return v_request; end if;
  if v_request.status not in ('requested', 'converted') then raise exception 'request_cannot_be_cancelled'; end if;

  if v_request.converted_shipment_id is not null then
    select * into v_shipment
    from public.shipments
    where id = v_request.converted_shipment_id
      and client_id = v_request.client_id
      and organization_id = v_request.organization_id
    for update;
    if v_shipment.id is null then raise exception 'converted_shipment_not_found'; end if;
    if v_shipment.status = 'cancelled' then
      update public.inventory_allocations
      set status = 'reserved', shipment_id = null, updated_at = now()
      where shipment_id = v_shipment.id and status = 'shipping';
      update public.shipment_items
      set removed_at = coalesce(removed_at, now())
      where shipment_id = v_shipment.id;
    elsif v_shipment.status not in ('draft', 'requested', 'awaiting_customer_approval', 'customer_approved') then
      raise exception 'shipment_cannot_be_cancelled';
    elsif v_shipment.superfrete_order_id is not null or v_shipment.checkout_status is not null then
      raise exception 'external_shipping_cancellation_requires_review';
    else
      update public.inventory_allocations
      set status = 'reserved', shipment_id = null, updated_at = now()
      where shipment_id = v_shipment.id and status = 'shipping';
      update public.shipment_items
      set removed_at = now()
      where shipment_id = v_shipment.id and removed_at is null;
      update public.shipments
      set status = 'cancelled', cancelled_at = now(), customer_approved_at = null,
        approved_by = null, updated_at = now()
      where id = v_shipment.id;
      insert into public.shipment_events(organization_id, shipment_id, event_type, from_status, to_status, actor_id)
      values(v_shipment.organization_id, v_shipment.id, 'shipment_cancelled', v_shipment.status, 'cancelled', p_actor_id);
    end if;
  end if;

  update public.customer_shipment_requests
  set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
  where id = v_request.id
  returning * into v_request;

  update public.task_assignments
  set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, p_actor_id),
    notes = coalesce(notes, 'Solicitação cancelada antes da postagem.')
  where organization_id = v_request.organization_id
    and entity_type = 'customer_shipment_request'
    and entity_id = v_request.id
    and resolved_at is null;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values(v_request.organization_id, p_actor_id, 'customer_request_cancelled', 'customer_shipment_request', v_request.id::text,
    jsonb_build_object('shipment_id', v_request.converted_shipment_id));
  return v_request;
end;
$$;
revoke all on function public.customer_shipment_request_cancel_core(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.customer_shipment_request_cancel(p_request_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare v_client_id uuid;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  return public.customer_shipment_request_cancel_core(p_request_id, v_client_id, auth.uid());
end;
$$;
revoke all on function public.customer_shipment_request_cancel(uuid) from public, anon;
grant execute on function public.customer_shipment_request_cancel(uuid) to authenticated;

create or replace function public.customer_shipment_request_cancel_staff(p_shipment_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare v_request public.customer_shipment_requests;
begin
  select * into v_request
  from public.customer_shipment_requests
  where converted_shipment_id = p_shipment_id
  for update;
  if v_request.id is null then raise exception 'customer_request_not_found'; end if;
  if not public.has_org_role(v_request.organization_id, array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  return public.customer_shipment_request_cancel_core(v_request.id, v_request.client_id, auth.uid());
end;
$$;
revoke all on function public.customer_shipment_request_cancel_staff(uuid) from public, anon;
grant execute on function public.customer_shipment_request_cancel_staff(uuid) to authenticated;

commit;
