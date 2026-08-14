begin;

alter table public.sales add column if not exists inventory_item_id uuid references public.inventory_items(id);

-- Items born from AI-inferred sales history never had a physical count.
-- They must stay auditable (physical_ml/bootstrap_ml visible) while being
-- ineligible for operational availability until a human confirms them via
-- the existing inventory_apply adjustment/entry flow (see redefinition below).
alter table public.inventory_items add column if not exists bootstrap_pending_verification boolean not null default false;

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
  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by)
  values(p_organization_id,perfume,p_reference_date,bootstrap_ml,bootstrap_ml,0,'active','Estoque registrado pelas vendas; aguardando conferência física. Origem: ai_sales_batch.','review_required',true,auth.uid())
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

-- Centralized availability fix: items awaiting physical verification (created
-- by bootstrap_ai_batch_inventory above) must not count as sellable stock
-- anywhere. physical_ml/bootstrap_ml remain visible for audit; available_ml
-- is masked to zero at the source used by every operational consumer
-- (Estoque page, new-sale selectors, AI import matching, reports).
create or replace function public.inventory_operational_rows(org_id uuid)
returns table(item_id uuid,perfume_id uuid,perfume text,physical_ml numeric,reserved_ml numeric,
  shipping_ml numeric,available_ml numeric,minimum_ml numeric,reconciliation_status text)
language sql stable security invoker set search_path=public as $$
  select i.id,p.id,p.full_name_raw,i.physical_ml,
    coalesce(sum(a.quantity_ml) filter(where a.status='reserved'),0),
    coalesce(sum(a.quantity_ml) filter(where a.status='shipping'),0),
    case when i.bootstrap_pending_verification then 0 else i.available_ml end,
    i.minimum_ml,i.reconciliation_status
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_allocations a on a.inventory_item_id=i.id
  where i.organization_id=org_id and i.status='active'
  group by i.id,p.id,p.full_name_raw order by p.full_name_raw;
$$;

-- Manual entry/adjustment through inventory_apply is the existing physical
-- conference mechanism (InventoryPage "Entrada"/"Ajustar"). Treat it as the
-- human confirmation event: clear the bootstrap-pending flag and resolve
-- review_required so the item re-enters normal operational availability.
-- Automatic movements (sale_out, cancellation_reversal) never touch a human,
-- so they must not clear the flag.
create or replace function public.inventory_apply(
  p_item_id uuid,p_quantity_ml numeric,p_type public.inventory_movement_type,
  p_reason text,p_notes text default null,p_sale_id uuid default null
) returns public.inventory_movements
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_movement public.inventory_movements; v_after numeric; v_physical_after numeric; v_confirms boolean;
begin
  select * into v_item from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if auth.uid() is not null and not public.has_org_role(v_item.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml=0 or btrim(coalesce(p_reason,''))='' then raise exception 'inventory_reason_and_quantity_required'; end if;
  v_after:=v_item.available_ml+p_quantity_ml;
  v_physical_after:=v_item.physical_ml+p_quantity_ml;
  if v_after<0 then raise exception 'insufficient_available_inventory'; end if;
  if v_physical_after<0 then raise exception 'insufficient_physical_inventory'; end if;
  v_confirms:=p_type in('entry','positive_adjustment','negative_adjustment','administrative_correction');
  update public.inventory_items set available_ml=v_after,physical_ml=v_physical_after,updated_at=now(),
    bootstrap_pending_verification=case when v_confirms then false else bootstrap_pending_verification end,
    reconciliation_status=case when v_confirms and reconciliation_status='review_required' then 'reconciled' else reconciliation_status end
    where id=v_item.id;
  insert into public.inventory_movements(
    organization_id,inventory_item_id,perfume_id,sale_id,movement_type,quantity_ml,
    balance_before,balance_after,reason,notes,created_by
  ) values(
    v_item.organization_id,v_item.id,v_item.perfume_id,p_sale_id,p_type,p_quantity_ml,
    v_item.available_ml,v_after,p_reason,p_notes,auth.uid()
  ) returning * into v_movement;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_movement','inventory_item',v_item.id::text,
    jsonb_build_object('movement_id',v_movement.id,'type',p_type,'quantity_ml',p_quantity_ml,
      'physical_before',v_item.physical_ml,'physical_after',v_physical_after,'sale_id',p_sale_id));
  return v_movement;
end;
$$;

-- Same masking applied to the older summary/health RPCs so AI report
-- aggregates and health labels never treat unverified bootstrap stock as
-- sellable either.
create or replace function public.inventory_summary(org_id uuid,start_date date,end_date date)
returns jsonb language sql stable security invoker set search_path=public
as $$
  select jsonb_build_object(
    'items',count(*),
    'available_ml',coalesce(sum(case when i.bootstrap_pending_verification then 0 else i.available_ml end),0),
    'healthy',count(*) filter(where not i.bootstrap_pending_verification and i.available_ml>i.minimum_ml),
    'low',count(*) filter(where not i.bootstrap_pending_verification and i.available_ml>0 and i.available_ml<=i.minimum_ml),
    'critical',count(*) filter(where not i.bootstrap_pending_verification and i.available_ml>0 and i.available_ml<=greatest(i.minimum_ml*.5,1)),
    'out_of_stock',count(*) filter(where i.bootstrap_pending_verification or i.available_ml=0),
    'consumed_ml',coalesce((select -sum(m.quantity_ml) from public.inventory_movements m where m.organization_id=org_id and m.movement_type='sale_out' and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    'movements',coalesce((select count(*) from public.inventory_movements m where m.organization_id=org_id and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0)
  ) from public.inventory_items i where i.organization_id=org_id and i.status='active';
$$;

create or replace function public.inventory_rows(org_id uuid,start_date date,end_date date)
returns table(
  item_id uuid,perfume_id uuid,perfume text,available_ml numeric,minimum_ml numeric,status text,
  sold_ml numeric,monthly_average numeric,estimated_days numeric,last_movement timestamptz
) language sql stable security invoker set search_path=public
as $$
  select i.id,p.id,p.full_name_raw,case when i.bootstrap_pending_verification then 0 else i.available_ml end,i.minimum_ml,
    case when i.bootstrap_pending_verification or i.available_ml=0 then 'Esgotado' when i.available_ml<=i.minimum_ml then 'Baixo' else 'Saudável' end,
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days'),0),
    case when coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days'),0)>0
      then round(case when i.bootstrap_pending_verification then 0 else i.available_ml end/(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days')/30),1) end,
    max(m.created_at) filter(where m.source<>'controlled_test')
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_movements m on m.inventory_item_id=i.id
  where i.organization_id=org_id group by i.id,p.id,p.full_name_raw order by i.available_ml asc,p.full_name_raw;
$$;

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
