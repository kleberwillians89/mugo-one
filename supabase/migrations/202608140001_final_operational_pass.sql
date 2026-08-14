-- Sprint operacional final: autoria imutável da conferência, refresh seguro do
-- destinatário e vínculo obrigatório da importação IA ao estoque canônico.

begin;

alter table public.shipments
  add column if not exists conference_owner_user_id uuid references public.profiles(id),
  add column if not exists conference_owner_name_snapshot text,
  add column if not exists conference_started_at timestamptz,
  add column if not exists conference_completed_at timestamptz;

-- Reafirma o contrato já adotado pela fundação operacional: alterações em
-- shipments passam pelos RPCs security definer, nunca por update direto.
revoke insert,update,delete on public.shipments from authenticated;

create or replace function public.assume_shipment_conference(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; actor_name text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.conference_owner_user_id is not null then
    if v.conference_owner_user_id<>auth.uid() then raise exception 'conference_already_owned'; end if;
    return v;
  end if;
  select coalesce((select nullif(btrim(full_name),'') from public.profiles where id=auth.uid()),'Usuário RUAH') into actor_name;
  update public.shipments set conference_owner_user_id=auth.uid(),conference_owner_name_snapshot=actor_name,
    conference_started_at=now(),updated_at=now() where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,metadata,actor_id)
    values(v.organization_id,v.id,'conference_assumed',jsonb_build_object('owner_name',actor_name),auth.uid());
  return v;
end;$$;
revoke all on function public.assume_shipment_conference(uuid) from public,anon;
grant execute on function public.assume_shipment_conference(uuid) to authenticated;

create or replace function public.prevent_conference_owner_change()
returns trigger language plpgsql set search_path=public as $$
declare actor_name text;
begin
  if old.conference_owner_user_id is null and new.conference_owner_user_id is not null then
    if auth.uid() is null or new.conference_owner_user_id<>auth.uid() then raise exception 'conference_owner_must_be_authenticated_user'; end if;
    select coalesce((select nullif(btrim(full_name),'') from public.profiles where id=auth.uid()),'Usuário RUAH') into actor_name;
    new.conference_owner_name_snapshot:=actor_name;
    new.conference_started_at:=now();
  elsif old.conference_owner_user_id is not null and
     (new.conference_owner_user_id is distinct from old.conference_owner_user_id or
      new.conference_owner_name_snapshot is distinct from old.conference_owner_name_snapshot or
      new.conference_started_at is distinct from old.conference_started_at) then
    raise exception 'conference_owner_immutable';
  end if;
  if new.conference_completed_at is distinct from old.conference_completed_at then
    if old.conference_completed_at is not null then raise exception 'conference_completion_immutable'; end if;
    if new.conference_completed_at is null or new.conference_owner_user_id is null or new.conference_owner_user_id<>auth.uid() then raise exception 'conference_completion_forbidden'; end if;
    if not public.has_org_role(new.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
    if not exists(select 1 from public.shipment_items where shipment_id=new.id and removed_at is null) then raise exception 'conference_items_required'; end if;
    if exists(select 1 from public.shipment_items where shipment_id=new.id and removed_at is null and (checked_at is null or divergence_note is not null)) then raise exception 'conference_items_incomplete'; end if;
    new.conference_completed_at:=now();
  end if;
  return new;
end;$$;
drop trigger if exists conference_owner_immutable on public.shipments;
create trigger conference_owner_immutable before update on public.shipments
for each row execute function public.prevent_conference_owner_change();

create or replace function public.update_shipment_item_check(
  p_shipment_id uuid,p_allocation_id uuid,p_separated boolean,p_checked boolean,p_divergence_note text default null
) returns public.shipment_items language plpgsql security definer set search_path=public as $$
declare v public.shipment_items; shipment public.shipments;
begin
  select * into shipment from public.shipments where id=p_shipment_id for update;
  if shipment.id is null or not public.has_org_role(shipment.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if shipment.conference_completed_at is not null then raise exception 'conference_already_completed'; end if;
  if shipment.conference_owner_user_id is null then raise exception 'conference_owner_required'; end if;
  if shipment.conference_owner_user_id<>auth.uid() then raise exception 'conference_owned_by_another_user'; end if;
  select * into v from public.shipment_items where shipment_id=p_shipment_id and allocation_id=p_allocation_id and removed_at is null for update;
  if v.id is null then raise exception 'shipment_item_not_found'; end if;
  update public.shipment_items set separated_at=case when p_separated then coalesce(separated_at,now()) else null end,
    separated_by=case when p_separated then coalesce(separated_by,auth.uid()) else null end,
    checked_at=case when p_checked then coalesce(checked_at,now()) else null end,
    checked_by=case when p_checked then coalesce(checked_by,auth.uid()) else null end,
    divergence_note=nullif(btrim(p_divergence_note),'') where id=v.id returning * into v;
  if not exists(select 1 from public.shipment_items where shipment_id=p_shipment_id and removed_at is null and (checked_at is null or divergence_note is not null))
     and shipment.conference_completed_at is null then
    update public.shipments set conference_completed_at=now(),updated_at=now() where id=p_shipment_id;
    insert into public.shipment_events(organization_id,shipment_id,event_type,actor_id) values(shipment.organization_id,p_shipment_id,'conference_completed',auth.uid());
  end if;
  return v;
end;$$;
revoke all on function public.update_shipment_item_check(uuid,uuid,boolean,boolean,text) from public,anon;
grant execute on function public.update_shipment_item_check(uuid,uuid,boolean,boolean,text) to authenticated;

alter table public.ai_sales_batches add column if not exists inventory_item_id uuid references public.inventory_items(id);

-- The existing RPC is retained, but its write path now validates this id and
-- derives the perfume from the tenant-owned inventory row. Applied by replacing
-- the relevant declarations/statements below in the deployed function body.
create or replace function public.validate_ai_batch_inventory(p_organization_id uuid,p_inventory_item_id uuid)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare perfume uuid;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select perfume_id into perfume from public.inventory_items where id=p_inventory_item_id and organization_id=p_organization_id and status='active';
  if perfume is null then raise exception 'inventory_item_resolution_required'; end if;
  return perfume;
end;$$;
revoke all on function public.validate_ai_batch_inventory(uuid,uuid) from public,anon;
grant execute on function public.validate_ai_batch_inventory(uuid,uuid) to authenticated,service_role;

-- confirm_ai_sales_batch is the write RPC used by the application. Keep the
-- single-inventory contract explicit here: the write itself resolves the
-- tenant-owned inventory item before inserting the batch and its sales.
create or replace function public.confirm_ai_sales_batch(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.ai_sales_batches; batch public.ai_sales_batches; item jsonb; client uuid; perfume uuid; inventory_item uuid; client_match_count int; created_clients int:=0; created_sales int:=0; incomplete int:=0; normalized text; signature text;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select * into existing from public.ai_sales_batches where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true); end if;
  if jsonb_typeof(p_batch->'groups')='array' and jsonb_array_length(p_batch->'groups')>1 then raise exception 'multi_perfume_batch_not_supported'; end if;
  inventory_item:=nullif(btrim(p_batch->>'inventory_item_id'),'')::uuid;
  perfume:=public.validate_ai_batch_inventory(p_organization_id,inventory_item);
  if coalesce(jsonb_array_length(p_batch->'sales'),0)=0 then raise exception 'sales_required'; end if;
  insert into public.ai_sales_batches(organization_id,fingerprint,source_text,perfume_id,inventory_item_id,perfume_name,bottle_number,sale_date,sales_count,total_ml,total_amount,announced_balance_ml,created_by)
  values(p_organization_id,p_fingerprint,p_source_text,perfume,inventory_item,p_batch->>'perfume',nullif(p_batch->>'bottle_number','')::int,(p_batch->>'sale_date')::date,jsonb_array_length(p_batch->'sales'),(p_batch->'totals'->>'volume_ml')::numeric,(p_batch->'totals'->>'amount')::numeric,nullif(p_batch->>'announced_balance_ml','')::numeric,auth.uid()) returning * into batch;
  for item in select * from jsonb_array_elements(p_batch->'sales') loop
    client:=nullif(item->>'client_id','')::uuid;
    if client is null then
      if coalesce(item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required'; end if;
      normalized:=btrim(regexp_replace(lower(unaccent(item->>'client_name')),'[^a-z0-9]+',' ','g'));
      select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
      if client_match_count>1 then raise exception 'client_resolution_ambiguous'; end if;
      if client_match_count=1 then select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null; end if;
      if client_match_count=0 then insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by) values(p_organization_id,item->>'client_name',item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;created_clients:=created_clients+1; end if;
    end if;
    if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client'; end if;
    signature:=encode(digest(p_fingerprint||'|'||created_sales::text,'sha256'),'hex');
    insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
    values(p_organization_id,client,perfume,(p_batch->>'sale_date')::date,(item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),p_batch->>'perfume',p_batch->>'perfume',item->>'sale_type',(item->>'volume_ml')::numeric,item->>'volume_ml',p_batch->>'deadline_raw',nullif(p_batch->>'shipping_deadline_date','')::date,'verified',true,now());
    created_sales:=created_sales+1;if coalesce(jsonb_array_length(item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
  end loop;
  update public.ai_sales_batches set result=jsonb_build_object('batch_id',batch.id,'sales_created',created_sales,'clients_created',created_clients,'shipping_incomplete',incomplete,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_confirmed','ai_sales_batch',batch.id,jsonb_build_object('fingerprint',left(p_fingerprint,12),'perfume_id',perfume,'inventory_item_id',inventory_item,'sales_created',created_sales,'clients_created',created_clients));
  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) to authenticated,service_role;

create or replace function public.refresh_shipment_recipient(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; c public.clients; old_cep text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.superfrete_order_id is not null or v.checkout_status in('paid','completed') then raise exception 'shipment_recipient_locked_after_purchase'; end if;
  select * into c from public.clients where id=v.client_id and organization_id=v.organization_id and deleted_at is null;
  if c.id is null then raise exception 'client_not_found'; end if;
  old_cep:=public.only_digits(v.recipient_postal_code);
  update public.shipments set recipient_name=c.name,
    recipient_phone=coalesce(nullif(btrim(c.phone),''),nullif(btrim(c.whatsapp_phone),'')),
    recipient_document=coalesce(nullif(btrim(c.cpf),''),nullif(btrim(c.cnpj),'')),recipient_email=c.email,
    recipient_postal_code=c.postal_code,recipient_address=c.address_line,recipient_number=c.address_number,recipient_complement=c.complement,
    recipient_district=c.district,recipient_city=c.city,recipient_state=c.state,
    selected_quote_id=case when old_cep is distinct from public.only_digits(c.postal_code) then null else selected_quote_id end,
    carrier=case when old_cep is distinct from public.only_digits(c.postal_code) then null else carrier end,
    service=case when old_cep is distinct from public.only_digits(c.postal_code) then null else service end,
    service_id=case when old_cep is distinct from public.only_digits(c.postal_code) then null else service_id end,
    shipping_price=case when old_cep is distinct from public.only_digits(c.postal_code) then null else shipping_price end,updated_at=now()
    where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,metadata,actor_id)
    values(v.organization_id,v.id,'recipient_snapshot_refreshed',jsonb_build_object('quote_invalidated',old_cep is distinct from public.only_digits(c.postal_code)),auth.uid());
  return v;
end;$$;
revoke all on function public.refresh_shipment_recipient(uuid) from public,anon;
grant execute on function public.refresh_shipment_recipient(uuid) to authenticated;

commit;
