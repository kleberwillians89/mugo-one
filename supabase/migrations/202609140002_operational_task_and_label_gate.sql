begin;

-- A emissão é a primeira ação externa que compromete saldo na SuperFrete.
-- Centralizamos aqui os gates comerciais e físicos para que UI, Edge Function
-- e chamadas diretas de RPC obedeçam à mesma regra.
create or replace function public.assert_shipment_label_ready(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  if exists(
    select 1 from public.shipment_items si join public.sales s on s.id=si.sale_id
    where si.shipment_id=v.id and si.removed_at is null and s.payment_status<>'paid'
  ) then raise exception 'payment_incomplete';end if;
  if exists(
    select 1 from public.shipment_items si join public.sales s on s.id=si.sale_id
    where si.shipment_id=v.id and si.removed_at is null
      and upper(coalesce(s.sale_type,'')) in('SPLIT','APC') and s.split_completed_at is null
  ) then raise exception 'split_incomplete';end if;
  if not exists(select 1 from public.shipment_items where shipment_id=v.id and removed_at is null)
     or exists(select 1 from public.shipment_items where shipment_id=v.id and removed_at is null and (checked_at is null or divergence_note is not null))
  then raise exception 'conference_incomplete';end if;
  if exists(
    select 1 from public.shipment_items si
    join public.inventory_allocations a on a.id=si.allocation_id
    join public.inventory_items i on i.id=a.inventory_item_id
    where si.shipment_id=v.id and si.removed_at is null and a.stock_managed
      and i.bottle_tracking_status='active' and si.bottle_id is null and si.split_unit_id is null
  ) then raise exception 'physical_source_not_confirmed';end if;
end;$$;
revoke all on function public.assert_shipment_label_ready(uuid) from public,anon;
grant execute on function public.assert_shipment_label_ready(uuid) to authenticated,service_role;

create or replace function public.claim_superfrete_cart(p_shipment_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.shipments;run public.integration_runs;missing text[]:='{}';
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  if v.superfrete_order_id is not null then return jsonb_build_object('claimed',false,'reason','order_exists','order_id',v.superfrete_order_id,'checkout_status',v.checkout_status);end if;
  select * into run from public.integration_runs where provider='superfrete' and operation='create_cart' and idempotency_key=p_idempotency_key;
  if run.id is not null and run.entity_id<>v.id then raise exception 'idempotency_key_conflict';end if;
  if run.id is not null and run.status='failed' and v.status='customer_approved' then
    perform public.assert_shipment_label_ready(v.id);
    update public.integration_runs set status='started',attempts=attempts+1,started_at=now(),completed_at=null,error_code=null,safe_error_message=null where id=run.id;
    update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
    return jsonb_build_object('claimed',true,'run_id',run.id);
  end if;
  if run.id is not null then return jsonb_build_object('claimed',false,'reason',run.status,'run_id',run.id);end if;
  if v.status<>'customer_approved' then raise exception 'shipment_not_customer_approved';end if;
  perform public.assert_shipment_label_ready(v.id);
  if coalesce(btrim(v.recipient_name),'')='' then missing:=array_append(missing,'recipient_name');end if;
  if coalesce(btrim(v.recipient_document),'')='' then missing:=array_append(missing,'recipient_document');end if;
  if coalesce(btrim(v.recipient_phone),'')='' then missing:=array_append(missing,'recipient_phone');end if;
  if coalesce(btrim(v.recipient_email),'')='' then missing:=array_append(missing,'recipient_email');end if;
  if length(coalesce(public.only_digits(v.recipient_postal_code),''))<>8 then missing:=array_append(missing,'recipient_postal_code');end if;
  if coalesce(btrim(v.recipient_address),'')='' then missing:=array_append(missing,'recipient_address');end if;
  if coalesce(btrim(v.recipient_number),'')='' then missing:=array_append(missing,'recipient_number');end if;
  if coalesce(btrim(v.recipient_district),'')='' then missing:=array_append(missing,'recipient_district');end if;
  if coalesce(btrim(v.recipient_city),'')='' then missing:=array_append(missing,'recipient_city');end if;
  if length(coalesce(btrim(v.recipient_state),''))<>2 then missing:=array_append(missing,'recipient_state');end if;
  if v.package_weight is null or v.package_height is null or v.package_width is null or v.package_length is null then missing:=array_append(missing,'package');end if;
  if v.service_id is null or v.selected_quote_id is null then missing:=array_append(missing,'service');end if;
  if cardinality(missing)>0 then return jsonb_build_object('claimed',false,'reason','incomplete_shipping_data','missing',missing);end if;
  insert into public.integration_runs(organization_id,provider,operation,entity_type,entity_id,idempotency_key,status,created_by)
    values(v.organization_id,'superfrete','create_cart','shipment',v.id,p_idempotency_key,'started',auth.uid()) returning * into run;
  update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
  return jsonb_build_object('claimed',true,'run_id',run.id);
end;$$;

create or replace function public.complete_superfrete_cart(p_shipment_id uuid,p_run_id uuid,p_order_id text,p_protocol text,p_price numeric)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  if coalesce(btrim(p_order_id),'')='' then raise exception 'external_order_required';end if;
  if v.superfrete_order_id is not null and v.superfrete_order_id<>p_order_id then raise exception 'shipment_already_has_other_order';end if;
  update public.shipments set superfrete_order_id=p_order_id,superfrete_protocol=nullif(p_protocol,''),shipping_price=coalesce(p_price,shipping_price),superfrete_status='pending',checkout_status='cart_created',updated_at=now() where id=v.id returning * into v;
  update public.integration_runs set external_id=p_order_id,status='succeeded',completed_at=now() where id=p_run_id and entity_id=v.id;
  return v;
end;$$;

create or replace function public.claim_superfrete_checkout(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.shipments;run public.integration_runs;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  if v.checkout_status in('released','checkout_succeeded') then return jsonb_build_object('claimed',false,'reason','already_released');end if;
  if v.checkout_status in('checkout_started','checkout_uncertain','cart_uncertain') then return jsonb_build_object('claimed',false,'reason',v.checkout_status);end if;
  if v.superfrete_order_id is null or v.checkout_status<>'cart_created' then raise exception 'cart_not_ready';end if;
  perform public.assert_shipment_label_ready(v.id);
  select * into run from public.integration_runs where provider='superfrete' and operation='checkout' and idempotency_key=v.id::text||':checkout:v1';
  if run.id is not null and run.status='failed' then update public.integration_runs set status='started',attempts=attempts+1,started_at=now(),completed_at=null,error_code=null,safe_error_message=null where id=run.id;
  elsif run.id is not null then return jsonb_build_object('claimed',false,'reason',run.status,'run_id',run.id);
  else insert into public.integration_runs(organization_id,provider,operation,entity_type,entity_id,idempotency_key,external_id,status,created_by)
    values(v.organization_id,'superfrete','checkout','shipment',v.id,v.id::text||':checkout:v1',v.superfrete_order_id,'started',auth.uid()) returning * into run;
  end if;
  update public.shipments set checkout_status='checkout_started',checkout_started_at=now(),integration_error=null,updated_at=now() where id=v.id;
  return jsonb_build_object('claimed',true,'run_id',run.id,'order_id',v.superfrete_order_id);
end;$$;

create or replace function public.mark_superfrete_operation(p_shipment_id uuid,p_run_id uuid,p_stage text,p_outcome text,p_code text,p_safe_message text)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;uncertain boolean:=p_outcome='uncertain';
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  if p_outcome not in('failed','uncertain') or p_stage not in('cart','checkout') then raise exception 'invalid_operation_outcome';end if;
  update public.integration_runs set status=p_outcome,error_code=left(p_code,80),safe_error_message=left(p_safe_message,500),completed_at=now() where id=p_run_id and entity_id=v.id;
  update public.shipments set status=case when not uncertain and p_stage='cart' then 'customer_approved'::public.shipment_status else status end,checkout_status=case when uncertain then p_stage||'_uncertain' when p_stage='cart' then 'cart_failed' else 'cart_created' end,integration_error=left(p_safe_message,500),updated_at=now() where id=v.id returning * into v;
  return v;
end;$$;

create or replace function public.apply_superfrete_state(p_shipment_id uuid,p_run_id uuid,p_state jsonb)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;external_status text;internal_status public.shipment_status;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.label') then raise exception 'forbidden';end if;
  external_status:=lower(coalesce(p_state->>'status',v.superfrete_status,''));
  internal_status:=case external_status when 'released' then 'label_released' when 'posted' then 'posted' when 'delivered' then 'delivered' when 'cancelled' then 'cancelled' when 'canceled' then 'cancelled' else v.status end;
  if internal_status in('posted','delivered') and v.status not in('posted','delivered') then
    if v.status not in('label_released','customer_approved') then update public.shipments set status='label_released',updated_at=now() where id=v.id;end if;
    perform public.post_shipment(v.id);select * into v from public.shipments where id=v.id;
  end if;
  if internal_status='cancelled' and v.status not in('posted','delivered','cancelled') then
    update public.inventory_allocations set status='reserved',shipment_id=null,updated_at=now() where shipment_id=v.id and status='shipping';
    update public.shipment_items set removed_at=coalesce(removed_at,now()) where shipment_id=v.id and removed_at is null;
  end if;
  update public.shipments set status=case when internal_status='posted' then status else internal_status end,
    superfrete_status=nullif(external_status,''),tracking_code=coalesce(p_state->>'tracking',tracking_code),
    print_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',print_url),label_pdf_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',label_pdf_url),
    shipping_price=coalesce(public.superfrete_safe_numeric(nullif(p_state->>'price','')),shipping_price),delivery_days=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery','')),delivery_days),
    delivery_min=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery_min','')),delivery_min),delivery_max=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery_max','')),delivery_max),
    label_generated_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'generated_at','')),label_generated_at),posted_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'posted_at','')),posted_at),
    delivered_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'delivered_at','')),delivered_at),cancelled_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'canceled_at','')),public.superfrete_safe_timestamptz(nullif(p_state->>'cancelled_at','')),cancelled_at),
    checkout_status=case when external_status='released' then 'released' else checkout_status end,checkout_completed_at=case when external_status='released' then coalesce(checkout_completed_at,now()) else checkout_completed_at end,
    superfrete_updated_at=now(),integration_error=null,updated_at=now() where id=v.id returning * into v;
  if p_run_id is not null then update public.integration_runs set status='succeeded',completed_at=now() where id=p_run_id and entity_id=v.id;end if;
  return v;
end;$$;

revoke all on function public.claim_superfrete_cart(uuid,text) from public,anon;
revoke all on function public.complete_superfrete_cart(uuid,uuid,text,text,numeric) from public,anon;
revoke all on function public.claim_superfrete_checkout(uuid) from public,anon;
revoke all on function public.mark_superfrete_operation(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.apply_superfrete_state(uuid,uuid,jsonb) from public,anon;
grant execute on function public.claim_superfrete_cart(uuid,text) to authenticated,service_role;
grant execute on function public.complete_superfrete_cart(uuid,uuid,text,text,numeric) to authenticated,service_role;
grant execute on function public.claim_superfrete_checkout(uuid) to authenticated,service_role;
grant execute on function public.mark_superfrete_operation(uuid,uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.apply_superfrete_state(uuid,uuid,jsonb) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
