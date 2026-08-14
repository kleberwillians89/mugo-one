begin;

-- Production error: function digest(text, unknown) does not exist.
--
-- Root cause: pgcrypto is created without an explicit SCHEMA clause in
-- 202607290001 (create extension if not exists pgcrypto;). On Supabase
-- projects provisioned in the last couple of years, pgcrypto ships
-- pre-installed in the "extensions" schema, so that CREATE EXTENSION IF NOT
-- EXISTS is a no-op there — it does NOT move/create it into "public". Every
-- write RPC that calls digest(...) is SECURITY DEFINER with
-- set search_path=public, so an unqualified digest() is invisible at
-- runtime, even though it type-checks fine in any local/dev database where
-- pgcrypto happens to live in public.
--
-- Fix: a single reusable helper that calls extensions.digest(...) — the
-- expected location — and falls back to public.digest(...) if that specific
-- function isn't there, instead of guessing blindly. search_path stays
-- restricted to public; nothing is widened to include extensions. Object
-- resolution inside a plpgsql body happens at execution time, not at
-- CREATE FUNCTION time, so this is safe to deploy without first confirming
-- which schema pgcrypto landed in on production.
create or replace function public.ai_sha256_hex(value text)
returns text language plpgsql immutable as $$
begin
  return encode(extensions.digest(value,'sha256'),'hex');
exception when undefined_function then
  return encode(public.digest(value,'sha256'),'hex');
end;
$$;
revoke all on function public.ai_sha256_hex(text) from public,anon;
grant execute on function public.ai_sha256_hex(text) to authenticated,service_role;

-- Same signature as 202608140002: a true replace, not a new overload.
-- Only the signature-computation line changes; every other line is
-- identical to the currently live function.
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
    signature:=public.ai_sha256_hex(p_fingerprint||'|'||created_sales::text);
    insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
    values(p_organization_id,client,perfume,inventory_item,(p_batch->>'sale_date')::date,(item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),p_batch->>'perfume',p_batch->>'perfume',item->>'sale_type',(item->>'volume_ml')::numeric,item->>'volume_ml',p_batch->>'deadline_raw',nullif(p_batch->>'shipping_deadline_date','')::date,'verified',true,now());
    created_sales:=created_sales+1;if coalesce(jsonb_array_length(item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
  end loop;
  update public.ai_sales_batches set result=jsonb_build_object('batch_id',batch.id,'sales_created',created_sales,'clients_created',created_clients,'shipping_incomplete',incomplete,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_confirmed','ai_sales_batch',batch.id,jsonb_build_object('fingerprint',left(p_fingerprint,12),'perfume_id',perfume,'inventory_item_id',inventory_item,'sales_created',created_sales,'clients_created',created_clients));
  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) to authenticated,service_role;

-- Same signature as 202608140003: a true replace, not a new overload. Only
-- the signature-computation line changes.
create or replace function public.confirm_ai_sales_batch_multi(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,
  p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  existing public.ai_sales_batch_imports;
  batch public.ai_sales_batch_imports;
  group_item jsonb; sale_item jsonb;
  group_inventory_item_id uuid; group_perfume_id uuid; group_perfume_name text;
  group_bootstrap_pending boolean;
  client uuid; normalized text; client_match_count int; signature text; payment_bucket text;
  sales_created int:=0; clients_created int:=0; clients_existing int:=0; incomplete int:=0;
  perfumes_processed int:=0; perfumes_matched int:=0; inventory_items_bootstrapped int:=0;
  total_ml numeric:=0; total_amount numeric:=0; availability_ml numeric:=0; availability_amount numeric:=0;
  paid_source_count int:=0; awaiting_source_count int:=0; unstated_payment_count int:=0;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select * into existing from public.ai_sales_batch_imports where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true); end if;
  if jsonb_typeof(p_groups)<>'array' or jsonb_array_length(p_groups)=0 then raise exception 'groups_required'; end if;

  for group_item in select * from jsonb_array_elements(p_groups) loop
    if nullif(btrim(group_item->>'inventory_item_id'),'') is null then raise exception 'inventory_resolution_required'; end if;
    if coalesce(jsonb_array_length(group_item->'sales'),0)=0 then raise exception 'sales_required'; end if;
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      if nullif(sale_item->>'client_id','') is null and coalesce(sale_item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required'; end if;
    end loop;
  end loop;

  insert into public.ai_sales_batch_imports(organization_id,fingerprint,source_text,sale_date,groups_count,created_by)
  values(p_organization_id,p_fingerprint,p_source_text,p_sale_date,jsonb_array_length(p_groups),auth.uid())
  returning * into batch;

  for group_item in select * from jsonb_array_elements(p_groups) loop
    group_inventory_item_id:=(group_item->>'inventory_item_id')::uuid;
    group_perfume_id:=public.validate_ai_batch_inventory(p_organization_id,group_inventory_item_id);
    select bootstrap_pending_verification into group_bootstrap_pending from public.inventory_items where id=group_inventory_item_id;
    if coalesce(group_bootstrap_pending,false) then inventory_items_bootstrapped:=inventory_items_bootstrapped+1; else perfumes_matched:=perfumes_matched+1; end if;
    perfumes_processed:=perfumes_processed+1;
    availability_ml:=availability_ml+coalesce((group_item->>'availability_ml')::numeric,0);
    availability_amount:=availability_amount+coalesce((group_item->>'availability_amount')::numeric,0);
    group_perfume_name:=coalesce(nullif(btrim(group_item->>'display_name'),''),group_item->>'perfume');

    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      client:=nullif(sale_item->>'client_id','')::uuid;
      if client is null then
        normalized:=btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'));
        select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
        if client_match_count>1 then raise exception 'client_resolution_ambiguous'; end if;
        if client_match_count=1 then
          select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
          clients_existing:=clients_existing+1;
        else
          insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by)
          values(p_organization_id,sale_item->>'client_name',sale_item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;
          clients_created:=clients_created+1;
        end if;
      else
        clients_existing:=clients_existing+1;
      end if;
      if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client'; end if;

      signature:=public.ai_sha256_hex(
        btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||
        public.normalize_ai_perfume_name(group_perfume_name)||'|'||coalesce(sale_item->>'sale_type','')||'|'||
        coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));

      insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
      values(p_organization_id,client,group_perfume_id,group_inventory_item_id,p_sale_date,(sale_item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),group_perfume_name,group_perfume_name,sale_item->>'sale_type',(sale_item->>'volume_ml')::numeric,sale_item->>'volume_ml',p_deadline_raw,p_shipping_deadline_date,'verified',true,now());

      sales_created:=sales_created+1;
      total_ml:=total_ml+(sale_item->>'volume_ml')::numeric;
      total_amount:=total_amount+(sale_item->>'amount')::numeric;
      if coalesce(jsonb_array_length(sale_item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1; end if;

      payment_bucket:=btrim(regexp_replace(lower(unaccent(coalesce(sale_item->>'payment_status_raw',''))),'[^a-z0-9]+',' ','g'));
      if payment_bucket in('pago','paga','quitado') then paid_source_count:=paid_source_count+1;
      elsif payment_bucket like '%aguard%' or payment_bucket like '%pendente%' or payment_bucket like '%nao pago%' then awaiting_source_count:=awaiting_source_count+1;
      else unstated_payment_count:=unstated_payment_count+1; end if;
    end loop;
  end loop;

  update public.ai_sales_batch_imports set
    sales_count=sales_created,total_ml=total_ml,total_amount=round(total_amount,2),
    availability_ml=availability_ml,availability_amount=round(availability_amount,2),
    result=jsonb_build_object(
      'batch_id',id,'sales_created',sales_created,'clients_created',clients_created,'clients_existing',clients_existing,
      'perfumes_processed',perfumes_processed,'perfumes_matched',perfumes_matched,'inventory_items_bootstrapped',inventory_items_bootstrapped,
      'total_ml_sold',total_ml,'total_amount_sold',round(total_amount,2),
      'commercial_remaining_ml',availability_ml,'commercial_remaining_amount',round(availability_amount,2),
      'shipping_incomplete',incomplete,'paid_source_count',paid_source_count,'awaiting_source_count',awaiting_source_count,
      'unstated_payment_count',unstated_payment_count,'idempotent',false
    )
    where id=batch.id returning * into batch;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'ai_sales_batch_multi_confirmed','ai_sales_batch_import',batch.id::text,
    jsonb_build_object('fingerprint',left(p_fingerprint,12),'groups',perfumes_processed,'sales_created',sales_created,'clients_created',clients_created,'inventory_items_bootstrapped',inventory_items_bootstrapped));

  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) to authenticated,service_role;

commit;
