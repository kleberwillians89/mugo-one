begin;

drop function public.customer_shipment_requests_list();
create function public.customer_shipment_requests_list()
returns table(
  id uuid, status text, requested_at timestamptz,
  cancelled_at timestamptz, items jsonb, converted_shipment_id uuid,
  shipment_status public.shipment_status, shipping_price numeric, carrier text,
  service text, selected_quote_id uuid, customer_approved_at timestamptz,
  tracking_code text, posted_at timestamptz, delivered_at timestamptz,
  shipment_cancelled_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.requested_at, r.cancelled_at,
    (select jsonb_agg(jsonb_build_object(
       'allocation_id', i.allocation_id, 'perfume_id', i.perfume_id,
       'perfume', p.full_name_raw, 'quantity_ml', i.quantity_ml
     ))
     from public.customer_shipment_request_items i
     join public.perfumes p on p.id = i.perfume_id
     where i.request_id = r.id),
    r.converted_shipment_id, sh.status, sh.shipping_price, sh.carrier, sh.service,
    sh.selected_quote_id, sh.customer_approved_at, sh.tracking_code, sh.posted_at,
    sh.delivered_at, sh.cancelled_at
  from public.customer_shipment_requests r
  left join public.shipments sh on sh.id = r.converted_shipment_id
  where r.client_id = public.current_customer_client()
  order by r.requested_at desc;
$$;
revoke all on function public.customer_shipment_requests_list() from public, anon;
grant execute on function public.customer_shipment_requests_list() to authenticated;

-- Shipments are canonical regardless of CRM, Minha RUAH, or legacy origin.
create or replace function public.customer_shipments_list()
returns table(
  shipment_id uuid, status public.shipment_status, created_at timestamptz,
  items jsonb, shipping_price numeric, carrier text, service text,
  selected_quote_id uuid, customer_approved_at timestamptz,
  tracking_code text, posted_at timestamptz, delivered_at timestamptz,
  cancelled_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select sh.id, sh.status, sh.created_at,
    (select jsonb_agg(jsonb_build_object(
      'allocation_id', si.allocation_id, 'perfume_id', a.perfume_id,
      'perfume', p.full_name_raw, 'quantity_ml', si.quantity_ml
    ) order by p.full_name_raw)
    from public.shipment_items si
    join public.inventory_allocations a on a.id = si.allocation_id
    join public.perfumes p on p.id = a.perfume_id
    where si.shipment_id = sh.id),
    sh.shipping_price, sh.carrier, sh.service, sh.selected_quote_id,
    sh.customer_approved_at, sh.tracking_code, sh.posted_at,
    sh.delivered_at, sh.cancelled_at
  from public.shipments sh
  where sh.client_id = public.current_customer_client()
  order by case when sh.status = 'awaiting_customer_approval' then 0 else 1 end,
    sh.created_at desc;
$$;
revoke all on function public.customer_shipments_list() from public, anon;
grant execute on function public.customer_shipments_list() to authenticated;

-- Auth ownership and the selected quote are authoritative; request is optional.
create or replace function public.customer_shipment_confirm(p_shipment_id uuid)
returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid; v_shipment public.shipments;
  v_quote public.shipment_quotes; v_request_id uuid;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  select * into v_shipment from public.shipments
  where id = p_shipment_id and client_id = v_client_id for update;
  if v_shipment.id is null then raise exception 'shipment_not_found'; end if;
  if v_shipment.status = 'customer_approved' then return v_shipment; end if;
  if v_shipment.status <> 'awaiting_customer_approval'
    or v_shipment.selected_quote_id is null then raise exception 'quote_not_available'; end if;
  select * into v_quote from public.shipment_quotes
  where id = v_shipment.selected_quote_id and shipment_id = v_shipment.id
    and organization_id = v_shipment.organization_id and available for share;
  if v_quote.id is null or v_quote.price is null
    or v_shipment.shipping_price is distinct from v_quote.price
    or v_shipment.carrier is distinct from v_quote.carrier
    or v_shipment.service is distinct from v_quote.service_name
    or v_shipment.service_id is distinct from v_quote.service_id then
    raise exception 'quote_changed';
  end if;
  select id into v_request_id from public.customer_shipment_requests
  where converted_shipment_id = v_shipment.id and client_id = v_client_id limit 1;
  update public.shipments set status = 'customer_approved',
    customer_approved_at = now(), approved_by = auth.uid(), updated_at = now()
  where id = v_shipment.id returning * into v_shipment;
  insert into public.shipment_events(
    organization_id, shipment_id, event_type, from_status, to_status, metadata, actor_id
  ) values(v_shipment.organization_id, v_shipment.id, 'customer_approved',
    'awaiting_customer_approval', 'customer_approved',
    jsonb_build_object('request_id', v_request_id, 'quote_id', v_quote.id,
      'quoted_amount', v_quote.price, 'provider', v_quote.carrier,
      'service', v_quote.service_name, 'source', 'minha_ruah'), auth.uid());
  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values(v_shipment.organization_id, auth.uid(), 'customer_shipping_confirmed',
    'shipment', v_shipment.id::text,
    jsonb_build_object('request_id', v_request_id, 'quote_id', v_quote.id,
      'quoted_amount', v_quote.price, 'provider', v_quote.carrier,
      'service', v_quote.service_name, 'source', 'minha_ruah'));
  return v_shipment;
end;
$$;
revoke all on function public.customer_shipment_confirm(uuid) from public, anon;
grant execute on function public.customer_shipment_confirm(uuid) to authenticated;

-- Compatibility wrapper; both origins use the same canonical approval path.
create or replace function public.customer_shipment_request_confirm(p_request_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_request public.customer_shipment_requests;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  select * into v_request from public.customer_shipment_requests
  where id = p_request_id and client_id = v_client_id for update;
  if v_request.id is null or v_request.converted_shipment_id is null then
    raise exception 'request_not_ready';
  end if;
  perform public.customer_shipment_confirm(v_request.converted_shipment_id);
  return v_request;
end;
$$;
revoke all on function public.customer_shipment_request_confirm(uuid) from public, anon;
grant execute on function public.customer_shipment_request_confirm(uuid) to authenticated;

commit;
