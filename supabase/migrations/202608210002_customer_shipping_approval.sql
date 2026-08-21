begin;

-- Staff may observe a customer's approval, but may never create one.
revoke execute on function public.approve_shipment_for_label(uuid) from authenticated;

-- Any privileged change to the quote snapshot invalidates a prior approval.
create or replace function public.invalidate_customer_shipping_approval()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'customer_approved'
    and new.status = 'customer_approved'
    and (
      new.selected_quote_id is distinct from old.selected_quote_id
      or new.shipping_price is distinct from old.shipping_price
      or new.carrier is distinct from old.carrier
      or new.service is distinct from old.service
      or new.service_id is distinct from old.service_id
    ) then
    new.status := 'awaiting_customer_approval';
    new.customer_approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_customer_shipping_approval on public.shipments;
create trigger invalidate_customer_shipping_approval
before update of selected_quote_id, shipping_price, carrier, service, service_id on public.shipments
for each row execute function public.invalidate_customer_shipping_approval();

revoke all on function public.invalidate_customer_shipping_approval() from public, anon, authenticated;

-- The portal sees only the customer-facing quote snapshot and approval state.
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
    (select jsonb_agg(jsonb_build_object('perfume', p.full_name_raw, 'quantity_ml', i.quantity_ml))
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

-- Idempotent customer-only approval of the exact quote currently selected.
create or replace function public.customer_shipment_request_confirm(p_request_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_request public.customer_shipment_requests;
  v_shipment public.shipments;
  v_quote public.shipment_quotes;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;

  select * into v_request
  from public.customer_shipment_requests
  where id = p_request_id and client_id = v_client_id
  for update;
  if v_request.id is null or v_request.converted_shipment_id is null then raise exception 'request_not_ready'; end if;

  select * into v_shipment
  from public.shipments
  where id = v_request.converted_shipment_id
    and client_id = v_client_id
    and organization_id = v_request.organization_id
  for update;
  if v_shipment.id is null then raise exception 'request_not_ready'; end if;
  if v_shipment.status = 'customer_approved' then return v_request; end if;
  if v_shipment.status <> 'awaiting_customer_approval' or v_shipment.selected_quote_id is null then
    raise exception 'quote_not_available';
  end if;

  select * into v_quote
  from public.shipment_quotes
  where id = v_shipment.selected_quote_id
    and shipment_id = v_shipment.id
    and organization_id = v_shipment.organization_id
    and available
  for share;
  if v_quote.id is null
    or v_quote.price is null
    or v_shipment.shipping_price is distinct from v_quote.price
    or v_shipment.carrier is distinct from v_quote.carrier
    or v_shipment.service is distinct from v_quote.service_name
    or v_shipment.service_id is distinct from v_quote.service_id then
    raise exception 'quote_changed';
  end if;

  update public.shipments
  set status = 'customer_approved', customer_approved_at = now(), approved_by = auth.uid(), updated_at = now()
  where id = v_shipment.id and status = 'awaiting_customer_approval';

  insert into public.shipment_events(organization_id, shipment_id, event_type, from_status, to_status, metadata, actor_id)
  values (v_shipment.organization_id, v_shipment.id, 'customer_approved', 'awaiting_customer_approval', 'customer_approved',
    jsonb_build_object('request_id', v_request.id, 'quote_id', v_quote.id, 'quoted_amount', v_quote.price,
      'provider', v_quote.carrier, 'service', v_quote.service_name), auth.uid());
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_shipment.organization_id, auth.uid(), 'customer_shipping_confirmed', 'shipment', v_shipment.id::text,
    jsonb_build_object('request_id', v_request.id, 'quote_id', v_quote.id, 'quoted_amount', v_quote.price,
      'provider', v_quote.carrier, 'service', v_quote.service_name));
  return v_request;
end;
$$;
revoke all on function public.customer_shipment_request_confirm(uuid) from public, anon;
grant execute on function public.customer_shipment_request_confirm(uuid) to authenticated;

commit;
