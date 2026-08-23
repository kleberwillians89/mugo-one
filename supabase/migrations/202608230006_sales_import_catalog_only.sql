begin;

-- Importação comercial resolve catálogo; nunca materializa estoque. Os nomes
-- bootstrap_* são preservados temporariamente apenas por compatibilidade.
create or replace function public.resolve_ai_catalog_perfume(
  p_organization_id uuid,p_raw_perfume_name text,p_brand text,p_selected_perfume_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare normalized text;canonical_name text;brand_normalized text;candidate_ids uuid[];candidate_count int;perfume public.perfumes;candidates jsonb;inventory_item uuid;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden';end if;
  normalized:=public.normalize_ai_perfume_name(p_raw_perfume_name);
  canonical_name:=btrim(regexp_replace(coalesce(p_raw_perfume_name,''),'\s*\(\s*frasco\s+[0-9]+\s*\)\s*$','','i'));
  if normalized='' then raise exception 'invalid_catalog_perfume';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'|catalog|'||normalized,230006));
  if p_selected_perfume_id is not null then
    select * into perfume from public.perfumes where id=p_selected_perfume_id and organization_id=p_organization_id;
    if perfume.id is null then raise exception 'invalid_perfume_selection';end if;
  else
    brand_normalized:=nullif(public.normalize_ai_brand(p_brand),'');
    select count(*),array_agg(p.id) into candidate_count,candidate_ids from public.perfumes p
    where p.organization_id=p_organization_id and public.normalize_ai_perfume_name(p.full_name_raw)=normalized
      and (brand_normalized is null or public.normalize_ai_brand(p.brand_house)=brand_normalized);
    if candidate_count=0 then
      select count(*),array_agg(p.id) into candidate_count,candidate_ids from public.perfumes p
      where p.organization_id=p_organization_id and (position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
    end if;
    if candidate_count>1 then
      select jsonb_agg(jsonb_build_object('perfume_id',p.id,'name',p.full_name_raw,'brand',p.brand_house,'bottle_identifier',p.bottle_identifier,'inventory_item_id',i.id,'reconciliation_status',i.reconciliation_status)) into candidates
      from public.perfumes p left join public.inventory_items i on i.organization_id=p.organization_id and i.perfume_id=p.id where p.id=any(candidate_ids);
      return jsonb_build_object('resolution_status','ambiguous','perfume_id',null,'inventory_item_id',null,'catalog_created',false,'candidates',coalesce(candidates,'[]'::jsonb));
    elsif candidate_count=1 then select * into perfume from public.perfumes where id=candidate_ids[1];
    else
      insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier)
      values(p_organization_id,canonical_name,normalized,canonical_name,nullif(btrim(p_brand),''),null) returning * into perfume;
    end if;
  end if;
  select id into inventory_item from public.inventory_items where organization_id=p_organization_id and perfume_id=perfume.id;
  return jsonb_build_object('resolution_status','resolved','perfume_id',perfume.id,'resolved_name',perfume.full_name_raw,'inventory_item_id',inventory_item,'catalog_created',candidate_count=0 and p_selected_perfume_id is null,'operational_code',perfume.operational_code);
end;$$;
revoke all on function public.resolve_ai_catalog_perfume(uuid,text,text,uuid) from public,anon;
grant execute on function public.resolve_ai_catalog_perfume(uuid,text,text,uuid) to authenticated;

create or replace function public.bootstrap_ai_batch_inventory(
  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,p_bottle_number integer,p_reference_date date,p_sales jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)=0 then raise exception 'sales_required';end if;
  return public.resolve_ai_catalog_perfume(p_organization_id,p_raw_perfume_name,p_brand,null);
end;$$;

create or replace function public.bootstrap_ai_batch_inventory_resolved(
  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,p_bottle_number integer,p_reference_date date,p_sales jsonb,p_selected_perfume_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)=0 then raise exception 'sales_required';end if;
  return public.resolve_ai_catalog_perfume(p_organization_id,p_raw_perfume_name,p_brand,p_selected_perfume_id);
end;$$;

-- Confirmação single: perfume é obrigatório; estoque é apenas um vínculo
-- opcional já existente e nunca é criado aqui.
create or replace function public.confirm_ai_sales_batch(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.ai_sales_batches;batch public.ai_sales_batches;item jsonb;client uuid;perfume public.perfumes;inventory_item uuid;client_match_count int;created_clients int:=0;created_sales int:=0;incomplete int:=0;normalized text;signature text;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden';end if;
  select * into existing from public.ai_sales_batches where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true);end if;
  select * into perfume from public.perfumes where id=nullif(p_batch->>'perfume_id','')::uuid and organization_id=p_organization_id;
  if perfume.id is null then raise exception 'perfume_resolution_required';end if;
  inventory_item:=nullif(p_batch->>'inventory_item_id','')::uuid;
  if inventory_item is not null and not exists(select 1 from public.inventory_items where id=inventory_item and organization_id=p_organization_id and perfume_id=perfume.id) then raise exception 'invalid_inventory_item';end if;
  if coalesce(jsonb_array_length(p_batch->'sales'),0)=0 then raise exception 'sales_required';end if;
  insert into public.ai_sales_batches(organization_id,fingerprint,source_text,perfume_id,inventory_item_id,perfume_name,bottle_number,sale_date,sales_count,total_ml,total_amount,announced_balance_ml,created_by)
  values(p_organization_id,p_fingerprint,p_source_text,perfume.id,inventory_item,perfume.full_name_raw,nullif(p_batch->>'bottle_number','')::int,(p_batch->>'sale_date')::date,jsonb_array_length(p_batch->'sales'),(p_batch->'totals'->>'volume_ml')::numeric,(p_batch->'totals'->>'amount')::numeric,nullif(p_batch->>'announced_balance_ml','')::numeric,auth.uid()) returning * into batch;
  for item in select * from jsonb_array_elements(p_batch->'sales') loop
    client:=nullif(item->>'client_id','')::uuid;
    if client is null then
      if coalesce(item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required';end if;
      normalized:=btrim(regexp_replace(lower(unaccent(item->>'client_name')),'[^a-z0-9]+',' ','g'));
      select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
      if client_match_count>1 then raise exception 'client_resolution_ambiguous';end if;
      if client_match_count=1 then select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;else insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by) values(p_organization_id,item->>'client_name',item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;created_clients:=created_clients+1;end if;
    end if;
    if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client';end if;
    signature:=public.ai_sha256_hex(p_fingerprint||'|'||created_sales::text);
    insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
    values(p_organization_id,client,perfume.id,inventory_item,(p_batch->>'sale_date')::date,(item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),perfume.full_name_raw,perfume.base_name,item->>'sale_type',(item->>'volume_ml')::numeric,item->>'volume_ml',p_batch->>'deadline_raw',nullif(p_batch->>'shipping_deadline_date','')::date,'verified',true,now());
    created_sales:=created_sales+1;if coalesce(jsonb_array_length(item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
  end loop;
  update public.ai_sales_batches set result=jsonb_build_object('batch_id',batch.id,'sales_created',created_sales,'clients_created',created_clients,'shipping_incomplete',incomplete,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_confirmed','ai_sales_batch',batch.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,12),'perfume_id',perfume.id,'inventory_item_id',inventory_item,'sales_created',created_sales,'clients_created',created_clients));
  return batch.result;
end;$$;

-- Confirmação multi equivalente, orientada por perfume_id.
create or replace function public.confirm_ai_sales_batch_multi(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.ai_sales_batch_imports;batch public.ai_sales_batch_imports;group_item jsonb;sale_item jsonb;group_perfume public.perfumes;group_inventory_item uuid;group_name text;client uuid;normalized text;client_match_count int;signature text;payment_bucket text;sales_created int:=0;clients_created int:=0;clients_existing int:=0;incomplete int:=0;perfumes_processed int:=0;perfumes_matched int:=0;v_total_ml numeric:=0;v_total_amount numeric:=0;v_availability_ml numeric:=0;v_availability_amount numeric:=0;paid_source_count int:=0;awaiting_source_count int:=0;unstated_payment_count int:=0;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden';end if;
  select * into existing from public.ai_sales_batch_imports where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true);end if;
  if jsonb_typeof(p_groups)<>'array' or jsonb_array_length(p_groups)=0 then raise exception 'groups_required';end if;
  insert into public.ai_sales_batch_imports(organization_id,fingerprint,source_text,sale_date,groups_count,created_by) values(p_organization_id,p_fingerprint,p_source_text,p_sale_date,jsonb_array_length(p_groups),auth.uid()) returning * into batch;
  for group_item in select * from jsonb_array_elements(p_groups) loop
    select * into group_perfume from public.perfumes where id=nullif(group_item->>'perfume_id','')::uuid and organization_id=p_organization_id;
    if group_perfume.id is null then raise exception 'perfume_resolution_required';end if;
    group_inventory_item:=nullif(group_item->>'inventory_item_id','')::uuid;
    if group_inventory_item is not null and not exists(select 1 from public.inventory_items where id=group_inventory_item and organization_id=p_organization_id and perfume_id=group_perfume.id) then raise exception 'invalid_inventory_item';end if;
    if coalesce(jsonb_array_length(group_item->'sales'),0)=0 then raise exception 'sales_required';end if;
    perfumes_processed:=perfumes_processed+1;if group_inventory_item is not null then perfumes_matched:=perfumes_matched+1;end if;
    v_availability_ml:=v_availability_ml+coalesce((group_item->>'availability_ml')::numeric,0);v_availability_amount:=v_availability_amount+coalesce((group_item->>'availability_amount')::numeric,0);group_name:=group_perfume.full_name_raw;
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      client:=nullif(sale_item->>'client_id','')::uuid;
      if client is null then
        if coalesce(sale_item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required';end if;
        normalized:=btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'));select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
        if client_match_count>1 then raise exception 'client_resolution_ambiguous';elsif client_match_count=1 then select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;clients_existing:=clients_existing+1;else insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by) values(p_organization_id,sale_item->>'client_name',sale_item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;clients_created:=clients_created+1;end if;
      else clients_existing:=clients_existing+1;end if;
      if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client';end if;
      signature:=public.ai_sha256_hex(btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||public.normalize_ai_perfume_name(group_name)||'|'||coalesce(sale_item->>'sale_type','')||'|'||coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));
      insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
      values(p_organization_id,client,group_perfume.id,group_inventory_item,p_sale_date,(sale_item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),group_name,group_perfume.base_name,sale_item->>'sale_type',(sale_item->>'volume_ml')::numeric,sale_item->>'volume_ml',p_deadline_raw,p_shipping_deadline_date,'verified',true,now());
      sales_created:=sales_created+1;v_total_ml:=v_total_ml+(sale_item->>'volume_ml')::numeric;v_total_amount:=v_total_amount+(sale_item->>'amount')::numeric;if coalesce(jsonb_array_length(sale_item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
      payment_bucket:=btrim(regexp_replace(lower(unaccent(coalesce(sale_item->>'payment_status_raw',''))),'[^a-z0-9]+',' ','g'));if payment_bucket in('pago','paga','quitado') then paid_source_count:=paid_source_count+1;elsif payment_bucket like '%aguard%' or payment_bucket like '%pendente%' or payment_bucket like '%nao pago%' then awaiting_source_count:=awaiting_source_count+1;else unstated_payment_count:=unstated_payment_count+1;end if;
    end loop;
  end loop;
  update public.ai_sales_batch_imports set sales_count=sales_created,total_ml=v_total_ml,total_amount=round(v_total_amount,2),availability_ml=v_availability_ml,availability_amount=round(v_availability_amount,2),result=jsonb_build_object('batch_id',id,'sales_created',sales_created,'clients_created',clients_created,'clients_existing',clients_existing,'perfumes_processed',perfumes_processed,'perfumes_matched',perfumes_matched,'inventory_items_bootstrapped',0,'catalog_perfumes_created',perfumes_processed-perfumes_matched,'total_ml_sold',v_total_ml,'total_amount_sold',round(v_total_amount,2),'commercial_remaining_ml',v_availability_ml,'commercial_remaining_amount',round(v_availability_amount,2),'shipping_incomplete',incomplete,'paid_source_count',paid_source_count,'awaiting_source_count',awaiting_source_count,'unstated_payment_count',unstated_payment_count,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_multi_confirmed','ai_sales_batch_import',batch.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,12),'groups',perfumes_processed,'sales_created',sales_created,'clients_created',clients_created,'inventory_items_created',0));
  return batch.result;
end;$$;

-- Dados históricos permanecem intactos. Somente os corpos das RPCs para novas
-- operações mudam; nenhuma linha de estoque ou movimento é alterada.
commit;
