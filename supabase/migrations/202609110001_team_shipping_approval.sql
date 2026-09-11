begin;

-- A seleção do frete continua separada da aprovação. A decisão passa a ser
-- exclusivamente operacional: a cliente solicita e acompanha, enquanto o
-- time com permissão de etiqueta valida a cotação antes da compra.
create or replace function public.approve_shipment_for_label(p_shipment_id uuid)
returns public.shipments
language plpgsql security definer set search_path=public as $$
declare
  v_shipment public.shipments;
  v_quote public.shipment_quotes;
begin
  select * into v_shipment from public.shipments
  where id=p_shipment_id for update;

  if v_shipment.id is null
    or not public.has_org_permission(v_shipment.organization_id,'shipping.label') then
    raise exception 'forbidden';
  end if;
  if v_shipment.status='customer_approved' then return v_shipment; end if;
  if v_shipment.status<>'awaiting_customer_approval'
    or v_shipment.selected_quote_id is null then
    raise exception 'shipment_not_awaiting_approval';
  end if;

  select * into v_quote from public.shipment_quotes
  where id=v_shipment.selected_quote_id
    and shipment_id=v_shipment.id
    and organization_id=v_shipment.organization_id
    and available
  for share;

  if v_quote.id is null or v_quote.price is null
    or v_shipment.shipping_price is distinct from v_quote.price
    or v_shipment.carrier is distinct from v_quote.carrier
    or v_shipment.service is distinct from v_quote.service_name
    or v_shipment.service_id is distinct from v_quote.service_id then
    raise exception 'quote_changed';
  end if;

  update public.shipments set
    status='customer_approved',customer_approved_at=now(),
    approved_by=auth.uid(),updated_at=now()
  where id=v_shipment.id returning * into v_shipment;

  insert into public.shipment_events(
    organization_id,shipment_id,event_type,from_status,to_status,metadata,actor_id
  ) values(
    v_shipment.organization_id,v_shipment.id,'customer_approved',
    'awaiting_customer_approval','customer_approved',
    jsonb_build_object('quote_id',v_quote.id,'quoted_amount',v_quote.price,
      'provider',v_quote.carrier,'service',v_quote.service_name,'source','ruah_team'),
    auth.uid()
  );
  insert into public.audit_logs(
    organization_id,actor_id,action,entity_type,entity_id,metadata
  ) values(
    v_shipment.organization_id,auth.uid(),'team_shipping_approved','shipment',
    v_shipment.id::text,
    jsonb_build_object('quote_id',v_quote.id,'quoted_amount',v_quote.price,
      'provider',v_quote.carrier,'service',v_quote.service_name,'source','ruah_team')
  );
  return v_shipment;
end;
$$;

revoke all on function public.approve_shipment_for_label(uuid) from public,anon;
grant execute on function public.approve_shipment_for_label(uuid) to authenticated,service_role;

-- O portal deixa de ser uma autoridade de aprovação. As funções antigas
-- permanecem instaladas apenas para preservar o histórico do schema, mas
-- não podem mais ser executadas por uma sessão de cliente.
revoke execute on function public.customer_shipment_confirm(uuid) from authenticated;
revoke execute on function public.customer_shipment_request_confirm(uuid) from authenticated;

commit;
