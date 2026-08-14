begin;

alter table public.sales add column if not exists inventory_item_id uuid references public.inventory_items(id);

create table if not exists public.ai_inventory_bootstraps(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null,
  normalized_perfume_name text not null,
  raw_perfume_name text not null,
  perfume_id uuid not null references public.perfumes(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  bootstrap_ml numeric(14,3) not null check(bootstrap_ml>0),
  source text not null default 'ai_sales_batch' check(source='ai_sales_batch'),
  reason text not null default 'bootstrap_from_sales' check(reason='bootstrap_from_sales'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(organization_id,fingerprint,normalized_perfume_name)
);
alter table public.ai_inventory_bootstraps enable row level security;
drop policy if exists ai_inventory_bootstraps_read on public.ai_inventory_bootstraps;
create policy ai_inventory_bootstraps_read on public.ai_inventory_bootstraps for select using(organization_id in(select public.current_user_org_ids()));
revoke insert,update,delete on public.ai_inventory_bootstraps from authenticated;

create or replace function public.normalize_ai_perfume_name(value text)
returns text language sql immutable parallel safe set search_path=public as $$
  select btrim(regexp_replace(lower(unaccent(regexp_replace(coalesce(value,''),'\s*\(\s*frasco\s+[0-9]+\s*\)\s*$','','i'))),'[^a-z0-9]+',' ','g'));
$$;

create or replace function public.bootstrap_ai_batch_inventory(
  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,
  p_bottle_number integer,p_reference_date date,p_sales jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare normalized text; canonical_name text; perfume_matches int; item_matches int; perfume uuid; item public.inventory_items; prior public.ai_inventory_bootstraps; base_name text; bootstrap_ml numeric;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  normalized:=public.normalize_ai_perfume_name(p_raw_perfume_name);
  canonical_name:=btrim(regexp_replace(coalesce(p_raw_perfume_name,''),'\s*\(\s*frasco\s+[0-9]+\s*\)\s*$','','i'));
  if jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)=0 then raise exception 'sales_required'; end if;
  select coalesce(sum((sale->>'volume_ml')::numeric),0) into bootstrap_ml from jsonb_array_elements(p_sales) sale where public.normalize_ai_perfume_name(coalesce(sale->>'perfume_name',p_raw_perfume_name))=normalized and (sale->>'volume_ml')::numeric>0;
  if normalized='' or bootstrap_ml<=0 or p_reference_date is null then raise exception 'invalid_inventory_bootstrap'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'|'||normalized,0));
  select * into prior from public.ai_inventory_bootstraps where organization_id=p_organization_id and fingerprint=p_fingerprint and normalized_perfume_name=normalized;
  if prior.id is not null then
    select * into item from public.inventory_items where id=prior.inventory_item_id and organization_id=p_organization_id;
    return jsonb_build_object('inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',true,'bootstrap_ml',prior.bootstrap_ml,'reconciliation_status',item.reconciliation_status);
  end if;
  select count(*) into item_matches from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
  if item_matches>1 then raise exception 'inventory_resolution_ambiguous'; end if;
  if item_matches=1 then
    select i.* into item from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
    if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;
    return jsonb_build_object('inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',false,'bootstrap_ml',0,'reconciliation_status',item.reconciliation_status);
  end if;
  select count(*) into perfume_matches from public.perfumes p where p.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
  if perfume_matches>1 then raise exception 'perfume_resolution_ambiguous'; end if;
  if perfume_matches=1 then
    select id into perfume from public.perfumes p where p.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
  else
    base_name:=btrim(split_part(regexp_replace(canonical_name,'\s+[—–-]\s+','|','g'),'|',1));
    insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier)
    values(p_organization_id,canonical_name,normalized,coalesce(nullif(base_name,''),canonical_name),nullif(btrim(p_brand),''),case when p_bottle_number is null then null else 'FRASCO '||p_bottle_number end)
    returning id into perfume;
  end if;
  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,status,notes,reconciliation_status,created_by)
  values(p_organization_id,perfume,p_reference_date,bootstrap_ml,bootstrap_ml,0,'active','Estoque registrado pelas vendas; aguardando conferência física. Origem: ai_sales_batch.','review_required',auth.uid())
  returning * into item;
  insert into public.inventory_movements(organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,balance_before,balance_after,reason,notes,created_by)
  values(p_organization_id,item.id,perfume,'opening',bootstrap_ml,0,bootstrap_ml,'bootstrap_from_sales','Origem: ai_sales_batch · fingerprint: '||left(p_fingerprint,16)||' · aguardando conferência física',auth.uid());
  insert into public.ai_inventory_bootstraps(organization_id,fingerprint,normalized_perfume_name,raw_perfume_name,perfume_id,inventory_item_id,bootstrap_ml,created_by)
  values(p_organization_id,p_fingerprint,normalized,p_raw_perfume_name,perfume,item.id,bootstrap_ml,auth.uid()) returning * into prior;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'ai_inventory_bootstrapped','inventory_item',item.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,16),'perfume_id',perfume,'bootstrap_ml',bootstrap_ml,'source','ai_sales_batch','reason','bootstrap_from_sales'));
  return jsonb_build_object('inventory_item_id',item.id,'perfume_id',perfume,'created',true,'idempotent',false,'bootstrap_ml',bootstrap_ml,'reconciliation_status','review_required');
end;$$;
revoke all on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) from public,anon;
grant execute on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) to authenticated;

-- Keep the existing single-perfume write behavior and add the resolved item
-- to every sale. Multi-perfume confirmation remains explicitly blocked.
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

commit;
