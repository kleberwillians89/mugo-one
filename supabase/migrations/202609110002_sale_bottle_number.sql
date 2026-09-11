begin;

-- O número do frasco pertence à venda/lote comercial. Ele não altera a
-- identidade canônica do perfume e não cria vínculo com inventory_bottles.
create or replace function public.davi_excel_create_sale_with_bottle(
  p_payload jsonb,
  p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  sale_id uuid;
  bottle text:=upper(nullif(btrim(p_payload->>'bottle_identifier'),''));
begin
  if bottle is null or bottle !~ '^FRASCO [1-9][0-9]*$' then
    raise exception 'bottle_number_required';
  end if;

  sale_id:=public.davi_excel_create_sale(p_payload,p_idempotency_key);
  update public.sales
     set bottle_identifier=bottle,
         updated_at=case when bottle_identifier is distinct from bottle then now() else updated_at end
   where id=sale_id
     and organization_id in(select public.current_user_org_ids())
     and bottle_identifier is distinct from bottle;
  return sale_id;
end;
$$;
revoke all on function public.davi_excel_create_sale_with_bottle(jsonb,text) from public,anon;
grant execute on function public.davi_excel_create_sale_with_bottle(jsonb,text) to authenticated;

create or replace function public.davi_excel_update_sale_with_bottle(
  p_sale_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_confirm_operational boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  sale_row public.sales;
  bottle text;
  remaining jsonb:=coalesce(p_patch,'{}'::jsonb)-'bottle_identifier';
  changed text[]:=array[]::text[];
begin
  if not (coalesce(p_patch,'{}'::jsonb)?'bottle_identifier') then
    return public.davi_excel_update_sale(p_sale_id,remaining,p_expected_updated_at,p_confirm_operational);
  end if;

  bottle:=upper(nullif(btrim(p_patch->>'bottle_identifier'),''));
  if bottle is not null and bottle !~ '^FRASCO [1-9][0-9]*$' then
    raise exception 'invalid_bottle_number';
  end if;

  if remaining<>'{}'::jsonb then
    result:=public.davi_excel_update_sale(p_sale_id,remaining,p_expected_updated_at,p_confirm_operational);
    p_expected_updated_at:=(result->>'updated_at')::timestamptz;
    select * into sale_row from public.sales where id=p_sale_id for update;
  else
    select * into sale_row from public.sales
     where id=p_sale_id
       and organization_id in(select public.current_user_org_ids())
       and deleted_at is null for update;
    if sale_row.id is null then raise exception 'sale_not_found'; end if;
    if not public.has_org_permission(sale_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;
    if sale_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;
  end if;

  if sale_row.bottle_identifier is distinct from bottle then
    update public.sales set bottle_identifier=bottle,updated_at=now()
     where id=p_sale_id returning * into sale_row;
    changed:=array['bottle_identifier'];
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(sale_row.organization_id,auth.uid(),'davi_excel_sale_bottle_updated','sale',sale_row.id::text,
      jsonb_build_object('sale_id',sale_row.id,'bottle_identifier',bottle));
  end if;

  return jsonb_build_object(
    'id',sale_row.id,
    'updated_at',sale_row.updated_at,
    'changed_fields',coalesce(result->'changed_fields','[]'::jsonb)||to_jsonb(changed),
    'shipment_snapshot_preserved',true
  );
end;
$$;
revoke all on function public.davi_excel_update_sale_with_bottle(uuid,jsonb,timestamptz,boolean) from public,anon;
grant execute on function public.davi_excel_update_sale_with_bottle(uuid,jsonb,timestamptz,boolean) to authenticated;

-- A importação com IA já conhece "Frasco N". Os wrappers persistem essa
-- referência na própria venda, inclusive quando o mesmo perfume aparece em
-- mais de um frasco no mesmo arquivo.
create or replace function public.confirm_ai_sales_batch_multi(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.ai_sales_batch_imports;batch public.ai_sales_batch_imports;group_item jsonb;sale_item jsonb;group_perfume public.perfumes;group_inventory_item uuid;group_name text;group_bottle text;client uuid;normalized text;client_match_count int;signature text;payment_bucket text;sales_created int:=0;clients_created int:=0;clients_existing int:=0;incomplete int:=0;perfumes_processed int:=0;perfumes_matched int:=0;v_total_ml numeric:=0;v_total_amount numeric:=0;v_availability_ml numeric:=0;v_availability_amount numeric:=0;paid_source_count int:=0;awaiting_source_count int:=0;unstated_payment_count int:=0;
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
    group_bottle:=case when nullif(group_item->>'bottle_number','') is null then null else 'FRASCO '||(group_item->>'bottle_number')::integer end;
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      client:=nullif(sale_item->>'client_id','')::uuid;
      if client is null then
        if coalesce(sale_item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required';end if;
        normalized:=btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'));select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
        if client_match_count>1 then raise exception 'client_resolution_ambiguous';elsif client_match_count=1 then select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;clients_existing:=clients_existing+1;else insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by) values(p_organization_id,sale_item->>'client_name',sale_item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;clients_created:=clients_created+1;end if;
      else clients_existing:=clients_existing+1;end if;
      if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client';end if;
      signature:=public.ai_sha256_hex(btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||public.normalize_ai_perfume_name(group_name)||'|'||coalesce(group_item->>'bottle_number','')||'|'||coalesce(sale_item->>'sale_type','')||'|'||coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));
      insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,bottle_identifier,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
      values(p_organization_id,client,group_perfume.id,group_inventory_item,p_sale_date,(sale_item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),group_name,group_perfume.base_name,group_bottle,sale_item->>'sale_type',(sale_item->>'volume_ml')::numeric,sale_item->>'volume_ml',p_deadline_raw,p_shipping_deadline_date,'verified',true,now());
      sales_created:=sales_created+1;v_total_ml:=v_total_ml+(sale_item->>'volume_ml')::numeric;v_total_amount:=v_total_amount+(sale_item->>'amount')::numeric;if coalesce(jsonb_array_length(sale_item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
      payment_bucket:=btrim(regexp_replace(lower(unaccent(coalesce(sale_item->>'payment_status_raw',''))),'[^a-z0-9]+',' ','g'));if payment_bucket in('pago','paga','quitado') then paid_source_count:=paid_source_count+1;elsif payment_bucket like '%aguard%' or payment_bucket like '%pendente%' or payment_bucket like '%nao pago%' then awaiting_source_count:=awaiting_source_count+1;else unstated_payment_count:=unstated_payment_count+1;end if;
    end loop;
  end loop;
  update public.ai_sales_batch_imports set sales_count=sales_created,total_ml=v_total_ml,total_amount=round(v_total_amount,2),availability_ml=v_availability_ml,availability_amount=round(v_availability_amount,2),result=jsonb_build_object('batch_id',id,'sales_created',sales_created,'clients_created',clients_created,'clients_existing',clients_existing,'perfumes_processed',perfumes_processed,'perfumes_matched',perfumes_matched,'inventory_items_bootstrapped',0,'catalog_perfumes_created',perfumes_processed-perfumes_matched,'total_ml_sold',v_total_ml,'total_amount_sold',round(v_total_amount,2),'commercial_remaining_ml',v_availability_ml,'commercial_remaining_amount',round(v_availability_amount,2),'shipping_incomplete',incomplete,'paid_source_count',paid_source_count,'awaiting_source_count',awaiting_source_count,'unstated_payment_count',unstated_payment_count,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_multi_confirmed','ai_sales_batch_import',batch.id::text,jsonb_build_object('fingerprint',left(p_fingerprint,12),'groups',perfumes_processed,'sales_created',sales_created,'clients_created',clients_created,'inventory_items_created',0));
  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) to authenticated,service_role;

create or replace function public.confirm_ai_sales_batch_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; idx integer; signature text; bottle text;
begin
  result:=public.confirm_ai_sales_batch(p_organization_id,p_fingerprint,p_source_text,p_batch);
  bottle:=case when nullif(p_batch->>'bottle_number','') is null then null else 'FRASCO '||(p_batch->>'bottle_number')::integer end;
  for idx in 0..greatest(coalesce(jsonb_array_length(p_batch->'sales'),0)-1,0) loop
    signature:=public.ai_sha256_hex(p_fingerprint||'|'||idx::text);
    update public.sales set
      bottle_identifier=bottle,
      shipping_availability_text=nullif(p_availability->>'text',''),
      shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),
      shipping_available_date=nullif(p_availability->>'date','')::date,
      shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,
      shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
    where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
  end loop;
  return result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) to authenticated,service_role;

create or replace function public.confirm_ai_sales_batch_multi_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; group_item jsonb; sale_item jsonb; signature text; perfume_name text; bottle text;
begin
  result:=public.confirm_ai_sales_batch_multi(p_organization_id,p_fingerprint,p_source_text,p_sale_date,p_shipping_deadline_date,p_deadline_raw,p_groups);
  for group_item in select * from jsonb_array_elements(p_groups) loop
    perfume_name:=coalesce(nullif(btrim(group_item->>'display_name'),''),group_item->>'perfume');
    bottle:=case when nullif(group_item->>'bottle_number','') is null then null else 'FRASCO '||(group_item->>'bottle_number')::integer end;
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      signature:=public.ai_sha256_hex(btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||public.normalize_ai_perfume_name(perfume_name)||'|'||coalesce(group_item->>'bottle_number','')||'|'||coalesce(sale_item->>'sale_type','')||'|'||coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));
      update public.sales set
        bottle_identifier=bottle,
        shipping_availability_text=nullif(p_availability->>'text',''),
        shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),
        shipping_available_date=nullif(p_availability->>'date','')::date,
        shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,
        shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
      where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
    end loop;
  end loop;
  return result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) to authenticated,service_role;

-- A grade do Davi recebe o frasco sem mudar o contrato do dataset-base. A
-- paginação, busca, filtro e ordenação continuam acontecendo no servidor.
create or replace function public.davi_excel_list_multi(
 p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,
 p_sorts jsonb default '[{"column":"sale_date","direction":"asc"},{"column":"perfume","direction":"asc"},{"column":"type","direction":"asc"},{"column":"volume","direction":"desc"}]'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare level jsonb;column_name text;direction text;expression text;order_clause text:='';result jsonb;position integer:=0;
begin
 if jsonb_typeof(p_sorts)<>'array' then raise exception 'invalid_sort';end if;
 for level in select value from jsonb_array_elements(p_sorts) loop
  position:=position+1;if position>5 then exit;end if;
  column_name:=level->>'column';direction:=lower(level->>'direction');
  if direction not in('asc','desc') then raise exception 'invalid_sort_direction';end if;
  expression:=case column_name
   when 'client' then 'public.davi_excel_sort_text(client_name)' when 'sale_date' then 'sale_date'
   when 'deadline' then 'shipping_deadline_date' when 'shipped_at' then 'shipped_at'
   when 'type' then 'public.davi_excel_sort_text(sale_type)' when 'volume' then 'volume_ml'
   when 'perfume' then 'public.davi_excel_sort_text(perfume_name)' when 'bottle' then 'public.davi_excel_sort_text(bottle_identifier)'
   when 'split_completed_at' then 'split_completed_at' when 'amount' then 'amount'
   when 'payment' then 'public.davi_excel_sort_text(payment_status)' when 'method' then 'public.davi_excel_sort_text(payment_method)'
   when 'paid_at' then 'paid_at' when 'credit' then 'credit_reference_amount'
   when 'notes' then 'public.davi_excel_sort_text(notes)' else null end;
  if expression is null then raise exception 'invalid_sort_column';end if;
  order_clause:=order_clause||case when order_clause='' then '' else ',' end||expression||' '||direction||' nulls last';
 end loop;
 if order_clause='' then order_clause:='sale_date asc nulls last,public.davi_excel_sort_text(perfume_name) asc nulls last,public.davi_excel_sort_text(sale_type) asc nulls last,volume_ml desc nulls last';end if;
 execute format($query$
  with base as(
   select d.*,s.bottle_identifier,(select count(*)::integer from public.sale_payment_attachments a where a.sale_id=d.id and a.deleted_at is null and public.has_org_permission(a.organization_id,'sales.edit')) attachment_count
   from public.davi_excel_dataset() d join public.sales s on s.id=d.id
  ),filtered as(
   select * from base d where
   (coalesce($1->>'search','')='' or d.client_name ilike '%%'||($1->>'search')||'%%' or d.perfume_name ilike '%%'||($1->>'search')||'%%' or d.bottle_identifier ilike '%%'||($1->>'search')||'%%' or d.notes ilike '%%'||($1->>'search')||'%%' or d.search_reference ilike '%%'||($1->>'search')||'%%') and
   (coalesce($1->>'attachment','all')='all' or ($1->>'attachment'='with' and d.attachment_count>0) or ($1->>'attachment'='without' and d.attachment_count=0)) and
   (coalesce($1->>'split','all')='all' or ($1->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or ($1->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
   (coalesce($1->>'gift','all')='all' or ($1->>'gift'='with' and d.has_gift) or ($1->>'gift'='without' and not d.has_gift)) and
   public.davi_excel_filter_matches($1#>'{columns,client}',d.client_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,type}',d.sale_type,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,perfume}',d.perfume_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,bottle}',d.bottle_identifier,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,amount}',d.amount::text,d.amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,payment}',d.payment_status,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,method}',d.payment_method,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,notes}',d.notes,null,null,'text')
  ),counted as(select *,count(*)over() total_count from filtered),ordered as(
   select * from counted order by %s,id desc limit $2 offset $3
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered
 $query$,order_clause) into result using coalesce(p_filters,'{}'::jsonb),least(greatest(p_page_size,1),500),greatest(p_page,0)*least(greatest(p_page_size,1),500);
 return result;
end;$$;
revoke all on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) from public,anon;
grant execute on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) to authenticated;

create or replace function public.davi_excel_distinct(p_column text,p_filters jsonb default '{}'::jsonb,p_search text default '',p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cleaned jsonb:=coalesce(p_filters,'{}'::jsonb);result jsonb;
begin
 if p_column not in('client','sale_date','deadline','shipped_at','type','volume','perfume','bottle','split_completed_at','amount','payment','method','paid_at','credit','notes') then raise exception 'invalid_filter_column';end if;
 cleaned:=jsonb_set(cleaned,'{columns}',coalesce(cleaned->'columns','{}'::jsonb)-p_column,true);
 with base as(select d.*,s.bottle_identifier from public.davi_excel_dataset() d join public.sales s on s.id=d.id),filtered as(
  select d.* from base d where
  (coalesce(cleaned->>'search','')='' or d.client_name ilike '%'||(cleaned->>'search')||'%' or d.perfume_name ilike '%'||(cleaned->>'search')||'%' or d.bottle_identifier ilike '%'||(cleaned->>'search')||'%' or d.notes ilike '%'||(cleaned->>'search')||'%') and
  (coalesce(cleaned->>'split','all')='all' or (cleaned->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or (cleaned->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
  (coalesce(cleaned->>'gift','all')='all' or (cleaned->>'gift'='with' and d.has_gift) or (cleaned->>'gift'='without' and not d.has_gift)) and
  public.davi_excel_filter_matches(cleaned#>'{columns,client}',d.client_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,type}',d.sale_type,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,perfume}',d.perfume_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,bottle}',d.bottle_identifier,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,amount}',d.amount::text,d.amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,payment}',d.payment_status,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,method}',d.payment_method,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,notes}',d.notes,null,null,'text')
 ),valueset as(
  select case p_column when 'client' then client_name when 'sale_date' then sale_date::text when 'deadline' then coalesce(shipping_deadline_display,operational_status) when 'shipped_at' then shipped_at::date::text when 'type' then sale_type when 'volume' then volume_ml::text when 'perfume' then perfume_name when 'bottle' then bottle_identifier when 'split_completed_at' then split_completed_at::text when 'amount' then amount::text when 'payment' then payment_status when 'method' then payment_method when 'paid_at' then paid_at::text when 'credit' then credit_reference_amount::text when 'notes' then notes end value,count(*) amount from filtered group by 1
 ),searched as(select * from valueset where coalesce(value,'') ilike '%'||coalesce(p_search,'')||'%'),windowed as(select *,count(*)over() total_values from searched order by value nulls first limit least(greatest(p_limit,1),250) offset greatest(p_offset,0))
 select jsonb_build_object('values',coalesce(jsonb_agg(jsonb_build_object('value',coalesce(value,'__BLANK__'),'count',amount) order by value nulls first),'[]'::jsonb),'total',coalesce(max(total_values),0),'has_more',coalesce(max(total_values),0)>greatest(p_offset,0)+least(greatest(p_limit,1),250)) into result from windowed;
 return coalesce(result,jsonb_build_object('values','[]'::jsonb,'total',0,'has_more',false));
end;$$;
revoke all on function public.davi_excel_distinct(text,jsonb,text,integer,integer) from public,anon;
grant execute on function public.davi_excel_distinct(text,jsonb,text,integer,integer) to authenticated;

commit;
