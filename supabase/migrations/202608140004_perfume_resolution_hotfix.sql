begin;

-- Root cause of the P0001 perfume_resolution_ambiguous crash: the previous
-- bootstrap resolution only compared the FULL normalized name (brand baked
-- in) via loose two-way substring matching, with no brand-aware exact tier
-- and no way to recover from a real duplicate other than a hard exception.
-- This hotfix adds a deterministic hierarchy (inventory item → exact
-- name+brand → weak substring → create) and turns genuine ambiguity into a
-- normal, non-exception result carrying candidates for human selection,
-- instead of crashing the write after the preview was already approved.
--
-- Signature safety: PostgreSQL identifies a function by (name, input
-- argument types). CREATE OR REPLACE FUNCTION only replaces an existing
-- function when the argument list matches exactly; appending a parameter
-- creates a SEPARATE overload instead of replacing anything, and the
-- original 7-argument bootstrap_ai_batch_inventory (already live from
-- 202608140002) would keep existing side by side with a new 8-argument one.
-- Two callable overloads for the same RPC name is a real PostgREST
-- ambiguity risk. So: bootstrap_ai_batch_inventory keeps its EXACT original
-- 7-argument signature (still the automatic, no-selection path). The
-- human-selection path is a distinctly named new function,
-- bootstrap_ai_batch_inventory_resolved, never an overload.

create or replace function public.normalize_ai_brand(value text)
returns text language sql immutable parallel safe set search_path=public as $$
  select btrim(regexp_replace(lower(unaccent(coalesce(value,''))),'[^a-z0-9]+',' ','g'));
$$;

-- Same signature as 202608140002: (uuid,text,text,text,integer,date,jsonb).
-- This is a true in-place replace, not a new overload.
create or replace function public.bootstrap_ai_batch_inventory(
  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,
  p_bottle_number integer,p_reference_date date,p_sales jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  normalized text; canonical_name text; item_matches int; perfume uuid; item public.inventory_items;
  prior public.ai_inventory_bootstraps; base_name text; bootstrap_ml numeric; brand_normalized text;
  exact_count int; weak_count int; candidate_ids uuid[]; candidates_json jsonb;
  distinct_normalized_count int;
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
    return jsonb_build_object('resolution_status','idempotent','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',true,'bootstrap_ml',prior.bootstrap_ml,'reconciliation_status',item.reconciliation_status);
  end if;

  -- A. Inventory item of the tenant first. Unchanged from the prior release.
  select count(*) into item_matches from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
  if item_matches>1 then raise exception 'inventory_resolution_ambiguous'; end if;
  if item_matches=1 then
    select i.* into item from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
    if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;
    return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',false,'bootstrap_ml',0,'reconciliation_status',item.reconciliation_status);
  end if;

  -- B. Canonical perfume: exact name+brand tier first, then a loose
  -- substring fallback, matching the deterministic hierarchy. No human
  -- selection is possible on this entry point; genuine ambiguity is
  -- returned as data (resolution_status='ambiguous'), never raised.
  brand_normalized:=nullif(public.normalize_ai_brand(p_brand),'');
  select count(*),array_agg(p.id) into exact_count,candidate_ids from public.perfumes p
    where p.organization_id=p_organization_id and public.normalize_ai_perfume_name(p.full_name_raw)=normalized
      and (brand_normalized is null or public.normalize_ai_brand(p.brand_house)=brand_normalized);
  if exact_count=0 then
    select count(*),array_agg(p.id) into weak_count,candidate_ids from public.perfumes p
      where p.organization_id=p_organization_id and (position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
    exact_count:=weak_count;
  end if;
  if exact_count>1 then
    select jsonb_agg(jsonb_build_object('perfume_id',p.id,'name',p.full_name_raw,'brand',p.brand_house,'bottle_identifier',p.bottle_identifier,'inventory_item_id',i.id,'reconciliation_status',i.reconciliation_status))
      into candidates_json
      from public.perfumes p left join public.inventory_items i on i.perfume_id=p.id and i.organization_id=p_organization_id
      where p.id=any(candidate_ids);
    select count(distinct public.normalize_ai_perfume_name(full_name_raw)) into distinct_normalized_count from public.perfumes where id=any(candidate_ids);
    if distinct_normalized_count=1 then
      insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
      values(p_organization_id,auth.uid(),'duplicate_canonical_perfume_detected','perfume',null,jsonb_build_object('normalized_perfume_name',normalized,'candidate_ids',candidate_ids));
    end if;
    return jsonb_build_object('resolution_status','ambiguous','candidates',coalesce(candidates_json,'[]'::jsonb),'inventory_item_id',null,'perfume_id',null,'created',false,'idempotent',false,'bootstrap_ml',0);
  elsif exact_count=1 then
    perfume:=candidate_ids[1];
  else
    base_name:=btrim(split_part(regexp_replace(canonical_name,'\s+[—–-]\s+','|','g'),'|',1));
    insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier)
    values(p_organization_id,canonical_name,normalized,coalesce(nullif(base_name,''),canonical_name),nullif(btrim(p_brand),''),case when p_bottle_number is null then null else 'FRASCO '||p_bottle_number end)
    returning id into perfume;
  end if;

  -- Defensive re-check by exact perfume_id: never create a second inventory
  -- item for the same tenant+perfume (also backed by the inventory_items
  -- unique(organization_id,perfume_id) constraint; this returns a friendly
  -- reuse instead of a raw DB error).
  select i.* into item from public.inventory_items i where i.perfume_id=perfume and i.organization_id=p_organization_id limit 1;
  if item.id is not null then
    if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;
    return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',false,'bootstrap_ml',0,'reconciliation_status',item.reconciliation_status);
  end if;

  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by)
  values(p_organization_id,perfume,p_reference_date,bootstrap_ml,bootstrap_ml,0,'active','Estoque registrado pelas vendas; aguardando conferência física. Origem: ai_sales_batch.','review_required',true,auth.uid())
  returning * into item;
  insert into public.inventory_movements(organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,balance_before,balance_after,reason,notes,created_by)
  values(p_organization_id,item.id,perfume,'opening',bootstrap_ml,0,bootstrap_ml,'bootstrap_from_sales','Origem: ai_sales_batch · fingerprint: '||left(p_fingerprint,16)||' · aguardando conferência física',auth.uid());
  insert into public.ai_inventory_bootstraps(organization_id,fingerprint,normalized_perfume_name,raw_perfume_name,perfume_id,inventory_item_id,bootstrap_ml,created_by)
  values(p_organization_id,p_fingerprint,normalized,p_raw_perfume_name,perfume,item.id,bootstrap_ml,auth.uid()) returning * into prior;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'ai_inventory_bootstrapped','inventory_item',item.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,16),'perfume_id',perfume,'bootstrap_ml',bootstrap_ml,'source','ai_sales_batch','reason','bootstrap_from_sales','selected_by_human',false));
  return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',perfume,'created',true,'idempotent',false,'bootstrap_ml',bootstrap_ml,'reconciliation_status','review_required');
end;$$;
revoke all on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) from public,anon;
grant execute on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) to authenticated;

-- Distinctly named RPC for the human-selection path. Never an overload of
-- bootstrap_ai_batch_inventory: different name entirely, so there is no
-- PostgREST candidate-function ambiguity regardless of which parameters a
-- given call includes.
create or replace function public.bootstrap_ai_batch_inventory_resolved(
  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,
  p_bottle_number integer,p_reference_date date,p_sales jsonb,p_selected_perfume_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  normalized text; item_matches int; perfume uuid; item public.inventory_items;
  prior public.ai_inventory_bootstraps; bootstrap_ml numeric; selected_name text;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_selected_perfume_id is null then raise exception 'perfume_selection_required'; end if;
  normalized:=public.normalize_ai_perfume_name(p_raw_perfume_name);
  if jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)=0 then raise exception 'sales_required'; end if;
  select coalesce(sum((sale->>'volume_ml')::numeric),0) into bootstrap_ml from jsonb_array_elements(p_sales) sale where public.normalize_ai_perfume_name(coalesce(sale->>'perfume_name',p_raw_perfume_name))=normalized and (sale->>'volume_ml')::numeric>0;
  if normalized='' or bootstrap_ml<=0 or p_reference_date is null then raise exception 'invalid_inventory_bootstrap'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'|'||normalized,0));
  select * into prior from public.ai_inventory_bootstraps where organization_id=p_organization_id and fingerprint=p_fingerprint and normalized_perfume_name=normalized;
  if prior.id is not null then
    select * into item from public.inventory_items where id=prior.inventory_item_id and organization_id=p_organization_id;
    return jsonb_build_object('resolution_status','idempotent','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',true,'bootstrap_ml',prior.bootstrap_ml,'reconciliation_status',item.reconciliation_status);
  end if;

  select count(*) into item_matches from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
  if item_matches>1 then raise exception 'inventory_resolution_ambiguous'; end if;
  if item_matches=1 then
    select i.* into item from public.inventory_items i join public.perfumes p on p.id=i.perfume_id where i.organization_id=p_organization_id and (public.normalize_ai_perfume_name(p.full_name_raw)=normalized or position(normalized in public.normalize_ai_perfume_name(p.full_name_raw))>0 or position(public.normalize_ai_perfume_name(p.full_name_raw) in normalized)>0);
    if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;
    return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',false,'bootstrap_ml',0,'reconciliation_status',item.reconciliation_status);
  end if;

  -- Never blind-trust a client-supplied uuid: must belong to this tenant
  -- and be name-compatible with the batch being confirmed.
  select id,full_name_raw into perfume,selected_name from public.perfumes where id=p_selected_perfume_id and organization_id=p_organization_id;
  if perfume is null then raise exception 'invalid_perfume_selection'; end if;
  if not(public.normalize_ai_perfume_name(selected_name)=normalized or position(normalized in public.normalize_ai_perfume_name(selected_name))>0 or position(public.normalize_ai_perfume_name(selected_name) in normalized)>0) then raise exception 'perfume_selection_incompatible'; end if;

  select i.* into item from public.inventory_items i where i.perfume_id=perfume and i.organization_id=p_organization_id limit 1;
  if item.id is not null then
    if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;
    return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',item.perfume_id,'created',false,'idempotent',false,'bootstrap_ml',0,'reconciliation_status',item.reconciliation_status);
  end if;

  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by)
  values(p_organization_id,perfume,p_reference_date,bootstrap_ml,bootstrap_ml,0,'active','Estoque registrado pelas vendas; aguardando conferência física. Origem: ai_sales_batch.','review_required',true,auth.uid())
  returning * into item;
  insert into public.inventory_movements(organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,balance_before,balance_after,reason,notes,created_by)
  values(p_organization_id,item.id,perfume,'opening',bootstrap_ml,0,bootstrap_ml,'bootstrap_from_sales','Origem: ai_sales_batch · fingerprint: '||left(p_fingerprint,16)||' · aguardando conferência física',auth.uid());
  insert into public.ai_inventory_bootstraps(organization_id,fingerprint,normalized_perfume_name,raw_perfume_name,perfume_id,inventory_item_id,bootstrap_ml,created_by)
  values(p_organization_id,p_fingerprint,normalized,p_raw_perfume_name,perfume,item.id,bootstrap_ml,auth.uid()) returning * into prior;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'ai_inventory_bootstrapped','inventory_item',item.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,16),'perfume_id',perfume,'bootstrap_ml',bootstrap_ml,'source','ai_sales_batch','reason','bootstrap_from_sales','selected_by_human',true));
  return jsonb_build_object('resolution_status','resolved','inventory_item_id',item.id,'perfume_id',perfume,'created',true,'idempotent',false,'bootstrap_ml',bootstrap_ml,'reconciliation_status','review_required');
end;$$;
revoke all on function public.bootstrap_ai_batch_inventory_resolved(uuid,text,text,text,integer,date,jsonb,uuid) from public,anon;
grant execute on function public.bootstrap_ai_batch_inventory_resolved(uuid,text,text,text,integer,date,jsonb,uuid) to authenticated;

commit;
