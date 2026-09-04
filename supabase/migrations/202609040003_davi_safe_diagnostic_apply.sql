begin;

-- Distância usada somente para repetir no banco o gate de ambiguidade do
-- diagnóstico (distância <= 2, ou inclusão para textos longos).
create or replace function public.davi_safe_levenshtein(p_left text,p_right text)
returns integer language plpgsql immutable strict set search_path=public as $$
declare
  left_size integer:=length(p_left);right_size integer:=length(p_right);
  previous integer[]:=array_fill(0,array[right_size+1]);current_row integer[];
  i integer;j integer;cost integer;
begin
  for j in 0..right_size loop previous[j+1]:=j;end loop;
  for i in 1..left_size loop
    current_row:=array_fill(0,array[right_size+1]);current_row[1]:=i;
    for j in 1..right_size loop
      cost:=case when substr(p_left,i,1)=substr(p_right,j,1) then 0 else 1 end;
      current_row[j+1]:=least(previous[j+1]+1,current_row[j]+1,previous[j]+cost);
    end loop;
    previous:=current_row;
  end loop;
  return previous[right_size+1];
end;$$;

create or replace function public.davi_safe_similar_text(p_left text,p_right text)
returns boolean language sql immutable strict set search_path=public as $$
 select p_left=p_right or public.davi_safe_levenshtein(p_left,p_right)<=2
   or (length(p_left)>8 and length(p_right)>8 and (position(p_left in p_right)>0 or position(p_right in p_left)>0));
$$;

revoke all on function public.davi_safe_levenshtein(text,text) from public,anon,authenticated;
revoke all on function public.davi_safe_similar_text(text,text) from public,anon,authenticated;

create or replace function public.apply_davi_safe_diagnostic_batch(
  p_organization_id uuid,
  p_file_name text,
  p_source_hash text,
  p_fingerprint text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  approved_changes constant text[]:=array['payment_status','payment_method','paid_at','shipped_at','credit','note','split_completed_at'];
  item jsonb;change_key text;change_keys text[];computed_fingerprint text;batch_key text;
  existing_batch public.import_batches;batch_id uuid;staging_id uuid;before_sale public.sales;after_sale public.sales;
  client_id uuid;perfume_id uuid;matching_count integer;active_allocation_count integer;affected integer;
  allocation public.inventory_allocations;inventory_item public.inventory_items;
  target_status public.payment_status;target_eligible boolean;required_ml numeric;remaining_ml numeric;
  inventory_balance jsonb:='{}'::jsonb;updates integer:=0;inserts integer:=0;changed_fields text[];
begin
  if auth.uid() is null then raise exception 'authentication_required';end if;
  if p_organization_id not in(select public.current_user_org_ids()) or not public.has_org_permission(p_organization_id,'sales.edit') then
    raise exception 'permission_denied';
  end if;
  if coalesce(btrim(p_file_name),'')='' or p_source_hash!~'^[0-9a-f]{64}$' or p_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception 'invalid_diagnostic_identity';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>10000 then
    raise exception 'invalid_safe_candidate_count';
  end if;
  if (select count(distinct (candidate.value->>'source_row')::integer) from jsonb_array_elements(p_rows) as candidate(value))<>jsonb_array_length(p_rows) then
    raise exception 'duplicate_source_row';
  end if;
  if (select count(distinct candidate.value->>'sale_id') from jsonb_array_elements(p_rows) as candidate(value)
      where candidate.value->>'identity_classification'='EXACT_EXISTING')<>
     (select count(*) from jsonb_array_elements(p_rows) as candidate(value)
      where candidate.value->>'identity_classification'='EXACT_EXISTING') then
    raise exception 'duplicate_update_sale';
  end if;

  select public.ai_sha256_hex(string_agg(concat_ws(chr(31),
    candidate.value->>'identity_classification',candidate.value->>'source_row',candidate.value->>'source_signature',coalesce(candidate.value->>'sale_id',''),
    coalesce(candidate.value->>'expected_updated_at',''),coalesce(candidate.value->>'resolved_client_id',''),candidate.value->>'client',candidate.value->>'display_client',
    coalesce(candidate.value->>'resolved_perfume_id',''),candidate.value->>'perfume',candidate.value->>'display_perfume',candidate.value->>'sale_date',candidate.value->>'sale_type',
    candidate.value->>'volume_ml',candidate.value->>'amount',candidate.value->>'payment_status',coalesce(candidate.value->>'payment_method',''),coalesce(candidate.value->>'paid_at',''),
    coalesce(candidate.value->>'shipped_at',''),coalesce(candidate.value->>'credit',''),coalesce(candidate.value->>'note',''),coalesce(candidate.value->>'split_completed_at',''),
    coalesce(candidate.value->>'expected_payment_status',''),coalesce(candidate.value->>'expected_payment_method',''),coalesce(candidate.value->>'expected_paid_at',''),
    coalesce(candidate.value->>'expected_shipped_at',''),coalesce(candidate.value->>'expected_credit',''),coalesce(candidate.value->>'expected_note',''),
    coalesce(candidate.value->>'expected_split_completed_at',''),coalesce((select string_agg(candidate_change.value,',' order by candidate_change.value)
      from jsonb_array_elements_text(candidate.value->'change_keys') as candidate_change(value)),''),candidate.value->>'stock_classification',
    coalesce(candidate.value->>'inventory_item_id',''),candidate.value->>'required_inventory_ml',coalesce(candidate.value->>'approved_new_decision',''),
    candidate.value->>'reason',candidate.value->>'confidence'),chr(30) order by (candidate.value->>'source_row')::integer))
  into computed_fingerprint from jsonb_array_elements(p_rows) as candidate(value);
  if computed_fingerprint is distinct from p_fingerprint then raise exception 'diagnostic_fingerprint_mismatch';end if;
  batch_key:=public.ai_sha256_hex(p_source_hash||'|'||p_fingerprint);
  perform pg_advisory_xact_lock(hashtextextended(batch_key,202609040003));

  select * into existing_batch from public.import_batches
   where organization_id=p_organization_id and file_hash=batch_key and status='completed' for update;
  if existing_batch.id is not null then
    if existing_batch.metadata->>'source_hash' is distinct from p_source_hash or existing_batch.metadata->>'fingerprint' is distinct from p_fingerprint then
      raise exception 'davi_safe_apply_idempotency_conflict';
    end if;
    return jsonb_build_object('batch_id',existing_batch.id,'idempotent',true,'updates',0,'inserts',0,'applied',0);
  end if;

  -- Pré-validação integral. Nenhuma tabela persistente é escrita antes de o
  -- último candidato passar por todas as garantias abaixo.
  for item in select candidate.value from jsonb_array_elements(p_rows) as candidate(value) order by (candidate.value->>'source_row')::integer loop
    if coalesce(item->>'identity_classification','') not in('NEW_SALE','EXACT_EXISTING')
       or coalesce(item->>'stock_classification','') not in('STOCK_OK','STOCK_NOT_REQUIRED')
       or coalesce(item->>'sale_type','') not in('APC','SPLIT')
       or coalesce(item->>'payment_status','') not in('paid','pending','cancelled','unknown')
       or item->>'sale_date' is null or (item->>'volume_ml')::numeric<=0 or (item->>'amount')::numeric<0 then
      raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','candidate_not_safe')::text;
    end if;
    change_keys:=array(select candidate_change.value from jsonb_array_elements_text(item->'change_keys') as candidate_change(value) order by candidate_change.value);
    foreach change_key in array change_keys loop
      if not(change_key=any(approved_changes)) then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','field_not_approved','field',change_key)::text;
      end if;
    end loop;

    before_sale:=null;client_id:=null;perfume_id:=null;allocation:=null;inventory_item:=null;required_ml:=0;
    if item->>'identity_classification'='EXACT_EXISTING' then
      if cardinality(change_keys)=0 or coalesce(item->>'sale_id','')='' or coalesce(item->>'expected_updated_at','')='' then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','update_snapshot_missing')::text;
      end if;
      select * into before_sale from public.sales where id=(item->>'sale_id')::uuid for update;
      if before_sale.id is null then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','sale_not_found')::text;end if;
      if before_sale.organization_id is distinct from p_organization_id then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','wrong_organization')::text;end if;
      if before_sale.deleted_at is not null then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','sale_archived')::text;end if;
      if before_sale.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','stale_updated_at')::text;end if;
      if before_sale.client_id is distinct from (item->>'resolved_client_id')::uuid or before_sale.perfume_id is distinct from (item->>'resolved_perfume_id')::uuid
         or before_sale.sale_date is distinct from (item->>'sale_date')::date or upper(before_sale.sale_type) is distinct from item->>'sale_type'
         or before_sale.volume_ml is distinct from (item->>'volume_ml')::numeric or before_sale.amount is distinct from (item->>'amount')::numeric then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','commercial_identity_changed')::text;
      end if;
      if before_sale.payment_status::text is distinct from item->>'expected_payment_status'
         or public.davi_excel_sort_text(before_sale.payment_method) is distinct from coalesce(item->>'expected_payment_method','')
         or coalesce(before_sale.paid_at::date::text,'') is distinct from coalesce(item->>'expected_paid_at','')
         or coalesce(before_sale.shipped_at::date::text,'') is distinct from coalesce(item->>'expected_shipped_at','')
         or coalesce(before_sale.credit_reference_amount::numeric::text,'') is distinct from coalesce((item->>'expected_credit')::numeric::text,'')
         or public.davi_excel_sort_text(before_sale.notes) is distinct from coalesce(item->>'expected_note','')
         or coalesce(before_sale.split_completed_at::date::text,'') is distinct from coalesce(item->>'expected_split_completed_at','') then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','mutable_state_changed')::text;
      end if;
      client_id:=before_sale.client_id;perfume_id:=before_sale.perfume_id;
      target_status:=case when 'payment_status'=any(change_keys) then (item->>'payment_status')::public.payment_status else before_sale.payment_status end;
      target_eligible:=before_sale.inventory_allocation_eligible;
    else
      if cardinality(change_keys)<>0 or nullif(item->>'sale_id','') is not null or nullif(item->>'expected_updated_at','') is not null then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','new_sale_payload_invalid')::text;
      end if;
      target_status:=(item->>'payment_status')::public.payment_status;target_eligible:=true;
      client_id:=nullif(item->>'resolved_client_id','')::uuid;
      if client_id is not null then
        if not exists(select 1 from public.clients where id=client_id and organization_id=p_organization_id and deleted_at is null) then
          raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','client_reference_invalid')::text;
        end if;
      else
        perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':client:'||(item->>'client'),202609040003));
        select count(*),(array_agg(id order by id))[1] into matching_count,client_id from public.clients where organization_id=p_organization_id and normalized_name=item->>'client' and deleted_at is null;
        if matching_count>1 or (matching_count=0 and exists(select 1 from public.clients c where c.organization_id=p_organization_id and c.deleted_at is null and public.davi_safe_similar_text(item->>'client',c.normalized_name))) then
          raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','client_became_ambiguous')::text;
        end if;
      end if;
      perfume_id:=nullif(item->>'resolved_perfume_id','')::uuid;
      if perfume_id is not null then
        if not exists(select 1 from public.perfumes where id=perfume_id and organization_id=p_organization_id) then
          raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','perfume_reference_invalid')::text;
        end if;
      else
        perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':perfume:'||(item->>'perfume'),202609040003));
        select count(*),(array_agg(id order by id))[1] into matching_count,perfume_id from public.perfumes where organization_id=p_organization_id and normalized_name=item->>'perfume';
        if matching_count>1 or (matching_count=0 and coalesce(item->>'approved_new_decision','')<>'MILK_PLUS_DISTINCT_NEW'
          and exists(select 1 from public.perfumes p where p.organization_id=p_organization_id and public.davi_safe_similar_text(item->>'perfume',p.normalized_name))) then
          raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','perfume_became_ambiguous')::text;
        end if;
      end if;
      if client_id is not null and perfume_id is not null and exists(select 1 from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null and s.client_id=client_id
        and s.perfume_id=perfume_id and s.sale_date=(item->>'sale_date')::date and upper(s.sale_type)=item->>'sale_type' and s.volume_ml=(item->>'volume_ml')::numeric and s.amount=(item->>'amount')::numeric) then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','safe_row_became_duplicate')::text;
      end if;
      if client_id is not null and perfume_id is not null and exists(select 1 from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null and s.client_id=client_id
        and ((s.perfume_id=perfume_id and upper(s.sale_type)=item->>'sale_type' and s.volume_ml=(item->>'volume_ml')::numeric and s.amount=(item->>'amount')::numeric and abs(s.sale_date-(item->>'sale_date')::date)<=3)
          or (s.perfume_id=perfume_id and upper(s.sale_type)=item->>'sale_type' and s.sale_date=(item->>'sale_date')::date and (s.volume_ml<>(item->>'volume_ml')::numeric or s.amount<>(item->>'amount')::numeric))
          or (s.perfume_id<>perfume_id and upper(s.sale_type)=item->>'sale_type' and s.sale_date=(item->>'sale_date')::date and s.volume_ml=(item->>'volume_ml')::numeric and s.amount=(item->>'amount')::numeric))) then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','new_sale_conflict_or_ambiguity')::text;
      end if;
    end if;

    select count(*) into active_allocation_count from public.inventory_allocations a where a.sale_id=before_sale.id and a.status in('reserved','shipping','shipped');
    if active_allocation_count>1 then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','multiple_active_allocations')::text;end if;
    if active_allocation_count=1 then select * into allocation from public.inventory_allocations a where a.sale_id=before_sale.id and a.status in('reserved','shipping','shipped') for update;end if;
    if target_status='paid' and target_eligible and perfume_id is not null and not(coalesce(allocation.allocation_source,'')='legacy_manual_verified') then
      if allocation.id is not null and allocation.status in('shipping','shipped') then required_ml:=0;
      else
        select count(*) into matching_count from public.inventory_items i where i.organization_id=p_organization_id and i.perfume_id=perfume_id and i.status='active';
        if matching_count<>1 then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code',case when matching_count=0 then 'stock_item_missing' else 'stock_item_ambiguous' end)::text;end if;
        select * into inventory_item from public.inventory_items i where i.organization_id=p_organization_id and i.perfume_id=perfume_id and i.status='active' for update;
        if (item->>'sale_date')::date>=inventory_item.reference_date then required_ml:=greatest((item->>'volume_ml')::numeric-coalesce(allocation.quantity_ml,0),0);end if;
      end if;
    elsif target_status<>'paid' and allocation.id is not null and allocation.allocation_source='operational_stock' and allocation.status in('shipping','shipped') then
      raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','active_shipping_allocation')::text;
    end if;
    if required_ml>0 then
      if item->>'stock_classification'<>'STOCK_OK' or inventory_item.id::text is distinct from item->>'inventory_item_id' or required_ml is distinct from (item->>'required_inventory_ml')::numeric then
        raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','stock_diagnostic_changed')::text;
      end if;
      remaining_ml:=coalesce((inventory_balance->>inventory_item.id::text)::numeric,inventory_item.available_ml)-required_ml;
      if remaining_ml<0 then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','stock_became_insufficient','inventory_item_id',inventory_item.id)::text;end if;
      inventory_balance:=jsonb_set(inventory_balance,array[inventory_item.id::text],to_jsonb(remaining_ml),true);
    elsif item->>'stock_classification'<>'STOCK_NOT_REQUIRED' or (item->>'required_inventory_ml')::numeric<>0 then
      raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','stock_not_required_changed')::text;
    end if;
  end loop;

  insert into public.import_batches(organization_id,file_name,file_hash,storage_path,sheet_name,status,total_rows,valid_rows,rejected_rows,duplicate_rows,processed_rows,raw_total,metadata,created_by)
  values(p_organization_id,p_file_name,batch_key,'davi-safe-diagnostic/'||batch_key,'DIAGNOSTICO_SEGURO','processing',jsonb_array_length(p_rows),jsonb_array_length(p_rows),0,0,0,
    (select coalesce(sum((candidate.value->>'amount')::numeric),0) from jsonb_array_elements(p_rows) as candidate(value)),
    jsonb_build_object('mode','davi_safe_diagnostic','source_hash',p_source_hash,'fingerprint',p_fingerprint,'candidate_rows',jsonb_array_length(p_rows)),auth.uid()) returning id into batch_id;

  insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by)
  select p_organization_id,(array_agg(candidate.value->>'display_client' order by (candidate.value->>'source_row')::integer))[1],
    (array_agg(candidate.value->>'display_client' order by (candidate.value->>'source_row')::integer))[1],candidate.value->>'client','active','spreadsheet','incremental_import',auth.uid()
  from jsonb_array_elements(p_rows) as candidate(value) where candidate.value->>'identity_classification'='NEW_SALE' and coalesce(candidate.value->>'resolved_client_id','')=''
    and not exists(select 1 from public.clients c where c.organization_id=p_organization_id and c.normalized_name=candidate.value->>'client' and c.deleted_at is null)
  group by candidate.value->>'client';

  insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,bottle_identifier)
  select p_organization_id,(array_agg(candidate.value->>'display_perfume' order by (candidate.value->>'source_row')::integer))[1],candidate.value->>'perfume',
    regexp_replace((array_agg(candidate.value->>'display_perfume' order by (candidate.value->>'source_row')::integer))[1],'\s*\(FRASCO\s*\d+\)\s*$','','i'),
    nullif((regexp_match((array_agg(candidate.value->>'display_perfume' order by (candidate.value->>'source_row')::integer))[1],'(FRASCO\s*\d+)','i'))[1],'')
  from jsonb_array_elements(p_rows) as candidate(value) where candidate.value->>'identity_classification'='NEW_SALE' and coalesce(candidate.value->>'resolved_perfume_id','')=''
    and not exists(select 1 from public.perfumes p where p.organization_id=p_organization_id and p.normalized_name=candidate.value->>'perfume')
  group by candidate.value->>'perfume' on conflict(organization_id,normalized_name) do nothing;

  for item in select candidate.value from jsonb_array_elements(p_rows) as candidate(value) order by (candidate.value->>'source_row')::integer loop
    change_keys:=array(select candidate_change.value from jsonb_array_elements_text(item->'change_keys') as candidate_change(value) order by candidate_change.value);
    insert into public.incremental_import_staging(organization_id,import_batch_id,source_row,raw_data,identity_signature,classification,match_sale_id,confidence,reason,proposed_changes,review_status)
    values(p_organization_id,batch_id,(item->>'source_row')::integer,jsonb_build_object('source_file',p_file_name,'source_hash',p_source_hash),item->>'source_signature',
      case when item->>'identity_classification'='NEW_SALE' then 'new_safe' else 'existing_changed' end,nullif(item->>'sale_id','')::uuid,(item->>'confidence')::numeric,
      item->>'reason',jsonb_build_object('change_keys',to_jsonb(change_keys)),'approved') returning id into staging_id;
    insert into public.import_rows(import_batch_id,organization_id,row_number,raw_data,normalized_data,is_valid,is_duplicate,import_signature,source_file,source_sheet,original_client,original_date,original_amount,original_payment_status,original_payment_method,warnings,blockers,is_accountable,row_type)
    values(batch_id,p_organization_id,(item->>'source_row')::integer,jsonb_build_object('source_file',p_file_name,'source_hash',p_source_hash),item,true,false,item->>'source_signature',p_file_name,'DIAGNOSTICO_SEGURO',
      item->>'display_client',item->>'sale_date',item->>'amount',item->>'payment_status',item->>'payment_method','{}','{}',item->>'payment_status' in('paid','pending'),'sale');

    if item->>'identity_classification'='EXACT_EXISTING' then
      select * into before_sale from public.sales where id=(item->>'sale_id')::uuid;
      update public.sales set
        payment_status=case when 'payment_status'=any(change_keys) then (item->>'payment_status')::public.payment_status else payment_status end,
        payment_method=case when 'payment_method'=any(change_keys) then nullif(btrim(item->>'payment_method'),'') else payment_method end,
        paid_at=case when 'paid_at'=any(change_keys) then nullif(item->>'paid_at','')::date else paid_at end,
        shipped_at=case when 'shipped_at'=any(change_keys) then nullif(item->>'shipped_at','')::date else shipped_at end,
        credit_reference_amount=case when 'credit'=any(change_keys) then nullif(item->>'credit','')::numeric else credit_reference_amount end,
        notes=case when 'note'=any(change_keys) then nullif(btrim(item->>'note'),'') else notes end,
        split_completed_at=case when 'split_completed_at'=any(change_keys) then nullif(item->>'split_completed_at','')::date else split_completed_at end,
        updated_at=now() where id=before_sale.id and updated_at=(item->>'expected_updated_at')::timestamptz returning * into after_sale;
      get diagnostics affected=row_count;if affected<>1 then raise exception 'davi_safe_apply_conflict:%',jsonb_build_object('row',item->>'source_row','code','concurrent_update')::text;end if;
      updates:=updates+1;
    else
      client_id:=nullif(item->>'resolved_client_id','')::uuid;if client_id is null then select id into client_id from public.clients where organization_id=p_organization_id and normalized_name=item->>'client' and deleted_at is null order by id limit 1;end if;
      perfume_id:=nullif(item->>'resolved_perfume_id','')::uuid;if perfume_id is null then select id into perfume_id from public.perfumes where organization_id=p_organization_id and normalized_name=item->>'perfume' order by id limit 1;end if;
      before_sale:=null;
      insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,notes,source,import_batch_id,import_signature,created_by,original_client,client_name_raw,original_date,original_amount,original_payment_status,original_payment_method,source_file,source_sheet,source_row,raw_data,data_quality_status,is_possible_duplicate,sale_type,volume_ml,volume_ml_raw,perfume_name_raw,perfume_base_name,bottle_identifier,paid_at,shipped_at,credit_reference_amount,split_completed_at,inventory_allocation_eligible)
      values(p_organization_id,client_id,perfume_id,(item->>'sale_date')::date,(item->>'amount')::numeric,(item->>'payment_status')::public.payment_status,nullif(btrim(item->>'payment_method'),''),nullif(btrim(item->>'note'),''),
        'spreadsheet_davi_safe_apply',batch_id,item->>'source_signature',auth.uid(),item->>'display_client',item->>'display_client',item->>'sale_date',item->>'amount',item->>'payment_status',item->>'payment_method',p_file_name,'DIAGNOSTICO_SEGURO',(item->>'source_row')::integer,
        jsonb_build_object('source_hash',p_source_hash,'fingerprint',p_fingerprint),'verified',false,item->>'sale_type',(item->>'volume_ml')::numeric,item->>'volume_ml',item->>'display_perfume',
        regexp_replace(item->>'display_perfume','\s*\(FRASCO\s*\d+\)\s*$','','i'),nullif((regexp_match(item->>'display_perfume','(FRASCO\s*\d+)','i'))[1],''),nullif(item->>'paid_at','')::date,
        nullif(item->>'shipped_at','')::date,nullif(item->>'credit','')::numeric,nullif(item->>'split_completed_at','')::date,true) returning * into after_sale;
      inserts:=inserts+1;
    end if;
    update public.incremental_import_staging set match_sale_id=after_sale.id,review_status='applied',applied_at=now() where id=staging_id;
    update public.import_rows set sale_id=after_sale.id where import_batch_id=batch_id and row_number=(item->>'source_row')::integer;
    insert into public.incremental_import_change_log(organization_id,import_batch_id,staging_id,sale_id,action,before_data,after_data,reason,confidence,actor_id)
    values(p_organization_id,batch_id,staging_id,after_sale.id,case when before_sale.id is null then 'insert' else 'update' end,
      case when before_sale.id is null then null else to_jsonb(before_sale)-'raw_data' end,to_jsonb(after_sale)-'raw_data',item->>'reason',(item->>'confidence')::numeric,auth.uid());
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'davi_safe_diagnostic_sale_applied','sale',after_sale.id::text,jsonb_build_object('batch_id',batch_id,'sale_id',after_sale.id,
      'before',case when before_sale.id is null then null else to_jsonb(before_sale) end,'after',to_jsonb(after_sale),'source',jsonb_build_object('file',p_file_name,'sha256',p_source_hash,'row',(item->>'source_row')::integer),
      'fingerprint',p_fingerprint,'timestamp',now(),'changed_fields',change_keys));
  end loop;
  update public.import_batches set status='completed',processed_rows=updates+inserts,completed_at=now(),metadata=metadata||jsonb_build_object('updates',updates,'inserts',inserts,'applied',updates+inserts) where id=batch_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'davi_safe_diagnostic_batch_applied','import_batch',batch_id::text,jsonb_build_object('batch_id',batch_id,'source',jsonb_build_object('file',p_file_name,'sha256',p_source_hash),
    'fingerprint',p_fingerprint,'timestamp',now(),'updates',updates,'inserts',inserts,'applied',updates+inserts));
  return jsonb_build_object('batch_id',batch_id,'idempotent',false,'updates',updates,'inserts',inserts,'applied',updates+inserts);
end;$$;

revoke all on function public.apply_davi_safe_diagnostic_batch(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.apply_davi_safe_diagnostic_batch(uuid,text,text,text,jsonb) to authenticated;

commit;
