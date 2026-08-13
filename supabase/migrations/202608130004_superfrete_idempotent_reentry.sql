-- Consulta a chave idempotente antes de validar o estado mutado pela primeira chamada.
create or replace function public.claim_superfrete_cart(p_shipment_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.shipments; run public.integration_runs; missing text[]:='{}';
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.superfrete_order_id is not null then return jsonb_build_object('claimed',false,'reason','order_exists','order_id',v.superfrete_order_id,'checkout_status',v.checkout_status); end if;
  select * into run from public.integration_runs where provider='superfrete' and operation='create_cart' and idempotency_key=p_idempotency_key;
  if run.id is not null and run.entity_id<>v.id then raise exception 'idempotency_key_conflict'; end if;
  if run.id is not null and run.status='failed' and v.status='customer_approved' then
    update public.integration_runs set status='started',attempts=attempts+1,started_at=now(),completed_at=null,error_code=null,safe_error_message=null where id=run.id;
    update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
    return jsonb_build_object('claimed',true,'run_id',run.id);
  end if;
  if run.id is not null then return jsonb_build_object('claimed',false,'reason',run.status,'run_id',run.id); end if;
  if v.status<>'customer_approved' then raise exception 'shipment_not_customer_approved'; end if;
  if coalesce(btrim(v.recipient_name),'')='' then missing:=array_append(missing,'recipient_name'); end if;
  if coalesce(btrim(v.recipient_document),'')='' then missing:=array_append(missing,'recipient_document'); end if;
  if coalesce(btrim(v.recipient_phone),'')='' then missing:=array_append(missing,'recipient_phone'); end if;
  if coalesce(btrim(v.recipient_email),'')='' then missing:=array_append(missing,'recipient_email'); end if;
  if length(coalesce(public.only_digits(v.recipient_postal_code),''))<>8 then missing:=array_append(missing,'recipient_postal_code'); end if;
  if coalesce(btrim(v.recipient_address),'')='' then missing:=array_append(missing,'recipient_address'); end if;
  if coalesce(btrim(v.recipient_number),'')='' then missing:=array_append(missing,'recipient_number'); end if;
  if coalesce(btrim(v.recipient_district),'')='' then missing:=array_append(missing,'recipient_district'); end if;
  if coalesce(btrim(v.recipient_city),'')='' then missing:=array_append(missing,'recipient_city'); end if;
  if length(coalesce(btrim(v.recipient_state),''))<>2 then missing:=array_append(missing,'recipient_state'); end if;
  if v.package_weight is null or v.package_height is null or v.package_width is null or v.package_length is null then missing:=array_append(missing,'package'); end if;
  if v.service_id is null or v.selected_quote_id is null then missing:=array_append(missing,'service'); end if;
  if cardinality(missing)>0 then return jsonb_build_object('claimed',false,'reason','incomplete_shipping_data','missing',missing); end if;
  insert into public.integration_runs(organization_id,provider,operation,entity_type,entity_id,idempotency_key,status,created_by)
    values(v.organization_id,'superfrete','create_cart','shipment',v.id,p_idempotency_key,'started',auth.uid()) returning * into run;
  update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
  return jsonb_build_object('claimed',true,'run_id',run.id);
end;$$;

revoke all on function public.claim_superfrete_cart(uuid,text) from public,anon;
grant execute on function public.claim_superfrete_cart(uuid,text) to authenticated,service_role;
