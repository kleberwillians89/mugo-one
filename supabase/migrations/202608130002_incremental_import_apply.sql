create table public.incremental_import_change_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  staging_id uuid references public.incremental_import_staging(id),
  sale_id uuid not null references public.sales(id),
  action text not null check(action in('update','insert')),
  before_data jsonb,
  after_data jsonb not null,
  reason text not null,
  confidence numeric(4,3),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.incremental_import_change_log enable row level security;
create policy incremental_change_log_select on public.incremental_import_change_log for select
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
revoke insert,update,delete on public.incremental_import_change_log from authenticated;

create or replace function public.apply_incremental_commercial_batch(
  p_organization_id uuid,
  p_user_id uuid,
  p_file_name text,
  p_file_hash text,
  p_sheet_name text,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_batch_id uuid;v_existing uuid;v_total integer;v_exact integer;v_changed integer;
  v_new integer;v_duplicate integer;v_review integer;v_updates integer;v_inserts integer;
  r record;v_sale public.sales;v_before jsonb;v_staging_id uuid;v_client_id uuid;v_perfume_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin')
    then raise exception 'administrator_membership_required'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'rows_must_be_array'; end if;

  select id into v_existing from public.import_batches
    where organization_id=p_organization_id and file_hash=p_file_hash and status='completed';
  if v_existing is not null then
    return jsonb_build_object('batch_id',v_existing,'idempotent',true,'updates',0,'inserts',0);
  end if;

  select count(*),count(*) filter(where item->>'classification'='existing_exact'),
    count(*) filter(where item->>'classification'='existing_changed'),
    count(*) filter(where item->>'classification'='new_safe'),
    count(*) filter(where item->>'classification'='possible_duplicate'),
    count(*) filter(where item->>'classification'='review_required')
  into v_total,v_exact,v_changed,v_new,v_duplicate,v_review from jsonb_array_elements(p_rows) item;
  if v_total=0 or v_total<>v_exact+v_changed+v_new+v_duplicate+v_review then raise exception 'invalid_classification_totals'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) item where item->>'classification'='existing_changed' and coalesce(item->>'match_candidate','')='')
    then raise exception 'changed_row_without_match'; end if;

  insert into public.import_batches(
    organization_id,file_name,file_hash,storage_path,sheet_name,status,total_rows,valid_rows,
    rejected_rows,duplicate_rows,processed_rows,raw_total,metadata,created_by
  ) values(
    p_organization_id,p_file_name,p_file_hash,'incremental-private/'||p_file_hash,p_sheet_name,
    'processing',v_total,v_exact+v_changed+v_new,v_review,v_duplicate,0,
    coalesce((select sum((item->>'amount')::numeric) from jsonb_array_elements(p_rows) item where item->>'amount' is not null),0),
    jsonb_build_object('mode','incremental','existing_exact',v_exact,'existing_changed',v_changed,
      'new_safe',v_new,'possible_duplicate',v_duplicate,'review_required',v_review,
      'historical_inventory_allocation_eligible',false),p_user_id
  ) returning id into v_batch_id;

  for r in select item from jsonb_array_elements(p_rows) item order by (item->>'source_row')::integer loop
    insert into public.incremental_import_staging(
      organization_id,import_batch_id,source_row,raw_data,identity_signature,classification,
      match_sale_id,confidence,reason,proposed_changes,review_status
    ) values(
      p_organization_id,v_batch_id,(r.item->>'source_row')::integer,r.item->'raw',r.item->>'signature',
      r.item->>'classification',nullif(r.item->>'match_candidate','')::uuid,
      nullif(r.item->>'confidence','')::numeric,r.item->>'reason',coalesce(r.item->'proposed_changes','{}'),
      case when r.item->>'classification' in('existing_exact','existing_changed','new_safe') then 'approved' else 'pending' end
    ) returning id into v_staging_id;

    insert into public.import_rows(
      import_batch_id,organization_id,row_number,raw_data,normalized_data,is_valid,is_duplicate,
      import_signature,source_file,source_sheet,original_client,original_date,original_amount,
      original_payment_status,original_payment_method,warnings,blockers,is_accountable,row_type
    ) values(
      v_batch_id,p_organization_id,(r.item->>'source_row')::integer,r.item->'raw',
      jsonb_build_object('client',r.item->>'client','sale_date',r.item->>'date','perfume',r.item->>'perfume',
        'sale_type',upper(r.item->>'type'),'volume_ml',r.item->'ml','amount',r.item->'amount',
        'payment_status',r.item->>'payment_status','classification',r.item->>'classification'),
      r.item->>'classification' in('existing_exact','existing_changed','new_safe'),
      r.item->>'classification'='possible_duplicate',r.item->>'signature',p_file_name,p_sheet_name,
      r.item->>'display_client',r.item->>'date',(r.item->>'amount'),r.item->>'payment_status',
      r.item->'raw'->>'FORMA DE PAGAMENTO',
      case when r.item->>'classification' in('possible_duplicate','review_required') then array[r.item->>'reason'] else '{}' end,
      case when r.item->>'classification'='review_required' then array[r.item->>'reason'] else '{}' end,
      r.item->>'classification' in('existing_exact','existing_changed','new_safe') and r.item->>'payment_status' in('paid','pending'),'sale'
    );
  end loop;

  insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by)
  select p_organization_id,(array_agg(item->>'display_client' order by (item->>'source_row')::integer))[1],
    (array_agg(item->>'display_client' order by (item->>'source_row')::integer))[1],item->>'client',
    'active','spreadsheet','incremental_import',p_user_id
  from jsonb_array_elements(p_rows) item where item->>'classification'='new_safe'
    and not exists(select 1 from public.clients c where c.organization_id=p_organization_id and c.normalized_name=item->>'client' and c.deleted_at is null)
  group by item->>'client';

  insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,bottle_identifier)
  select p_organization_id,(array_agg(item->>'display_perfume' order by (item->>'source_row')::integer))[1],
    item->>'perfume',regexp_replace((array_agg(item->>'display_perfume' order by (item->>'source_row')::integer))[1],'\s*\(FRASCO\s*\d+\)\s*$','','i'),
    nullif((regexp_match((array_agg(item->>'display_perfume' order by (item->>'source_row')::integer))[1],'(FRASCO\s*\d+)','i'))[1],'')
  from jsonb_array_elements(p_rows) item where item->>'classification'='new_safe'
    and not exists(select 1 from public.perfumes p where p.organization_id=p_organization_id and p.normalized_name=item->>'perfume')
  group by item->>'perfume' on conflict(organization_id,normalized_name) do nothing;

  for r in select item from jsonb_array_elements(p_rows) item where item->>'classification'='existing_changed'
  loop
    select * into v_sale from public.sales where id=(r.item->>'match_candidate')::uuid
      and organization_id=p_organization_id and deleted_at is null for update;
    if not found or v_sale.inventory_allocation_eligible then raise exception 'unsafe_changed_match'; end if;
    v_before:=jsonb_build_object('payment_status',v_sale.payment_status,'payment_method',v_sale.payment_method,
      'paid_at',v_sale.paid_at,'shipped_at',v_sale.shipped_at,'credit_reference_amount',v_sale.credit_reference_amount);
    update public.sales set
      payment_status=(r.item->>'payment_status')::public.payment_status,
      payment_method=nullif(r.item->'raw'->>'FORMA DE PAGAMENTO',''),
      paid_at=nullif(r.item->>'paid_at','')::date,
      shipped_at=nullif(r.item->>'shipped_at','')::date,
      credit_reference_amount=nullif(r.item->>'credit','')::numeric,
      updated_at=now()
    where id=v_sale.id returning * into v_sale;
    select id into v_staging_id from public.incremental_import_staging
      where import_batch_id=v_batch_id and source_row=(r.item->>'source_row')::integer;
    insert into public.incremental_import_change_log(
      organization_id,import_batch_id,staging_id,sale_id,action,before_data,after_data,reason,confidence,actor_id
    ) values(p_organization_id,v_batch_id,v_staging_id,v_sale.id,'update',v_before,
      to_jsonb(v_sale)-'raw_data',r.item->>'reason',nullif(r.item->>'confidence','')::numeric,p_user_id);
    update public.incremental_import_staging set review_status='applied',applied_at=now() where id=v_staging_id;
    v_updates:=coalesce(v_updates,0)+1;
  end loop;

  for r in select item from jsonb_array_elements(p_rows) item where item->>'classification'='new_safe' order by (item->>'source_row')::integer
  loop
    select id into v_client_id from public.clients where organization_id=p_organization_id and normalized_name=r.item->>'client' and deleted_at is null;
    select id into v_perfume_id from public.perfumes where organization_id=p_organization_id and normalized_name=r.item->>'perfume';
    if v_client_id is null or v_perfume_id is null then raise exception 'unresolved_safe_reference'; end if;
    if exists(select 1 from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null
      and s.client_id=v_client_id and s.sale_date=(r.item->>'date')::date and s.perfume_id=v_perfume_id
      and s.sale_type=upper(r.item->>'type') and s.volume_ml=(r.item->>'ml')::numeric and s.amount=(r.item->>'amount')::numeric)
      then raise exception 'safe_row_became_duplicate'; end if;
    insert into public.sales(
      organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,notes,
      source,import_batch_id,import_signature,created_by,original_client,client_name_raw,
      original_date,original_amount,original_payment_status,original_payment_method,source_file,
      source_sheet,source_row,raw_data,data_quality_status,is_possible_duplicate,sale_type,volume_ml,
      volume_ml_raw,perfume_name_raw,perfume_base_name,bottle_identifier,paid_at,shipped_at,
      credit_reference_amount,inventory_allocation_eligible
    ) values(
      p_organization_id,v_client_id,v_perfume_id,(r.item->>'date')::date,(r.item->>'amount')::numeric,
      (r.item->>'payment_status')::public.payment_status,nullif(r.item->'raw'->>'FORMA DE PAGAMENTO',''),
      nullif(r.item->'raw'->>'OBSERVAÇÃO',''),'spreadsheet_incremental',v_batch_id,r.item->>'signature',p_user_id,
      r.item->>'display_client',r.item->>'display_client',r.item->>'date',r.item->>'amount',
      r.item->'raw'->>'PAGAMENTO',r.item->'raw'->>'FORMA DE PAGAMENTO',p_file_name,p_sheet_name,
      (r.item->>'source_row')::integer,r.item->'raw','verified',false,upper(r.item->>'type'),
      (r.item->>'ml')::numeric,r.item->'raw'->>'ML',r.item->>'display_perfume',
      regexp_replace(r.item->>'display_perfume','\s*\(FRASCO\s*\d+\)\s*$','','i'),
      nullif((regexp_match(r.item->>'display_perfume','(FRASCO\s*\d+)','i'))[1],''),
      nullif(r.item->>'paid_at','')::date,nullif(r.item->>'shipped_at','')::date,
      nullif(r.item->>'credit','')::numeric,false
    ) returning * into v_sale;
    select id into v_staging_id from public.incremental_import_staging where import_batch_id=v_batch_id and source_row=(r.item->>'source_row')::integer;
    update public.import_rows set sale_id=v_sale.id where import_batch_id=v_batch_id and row_number=(r.item->>'source_row')::integer;
    update public.incremental_import_staging set match_sale_id=v_sale.id,review_status='applied',applied_at=now() where id=v_staging_id;
    insert into public.incremental_import_change_log(organization_id,import_batch_id,staging_id,sale_id,action,after_data,reason,confidence,actor_id)
      values(p_organization_id,v_batch_id,v_staging_id,v_sale.id,'insert',to_jsonb(v_sale)-'raw_data',r.item->>'reason',nullif(r.item->>'confidence','')::numeric,p_user_id);
    v_inserts:=coalesce(v_inserts,0)+1;
  end loop;

  update public.import_batches set status='completed',processed_rows=coalesce(v_updates,0)+coalesce(v_inserts,0),completed_at=now()
    where id=v_batch_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_user_id,'incremental_import_applied','import_batch',v_batch_id::text,
      jsonb_build_object('updates',coalesce(v_updates,0),'inserts',coalesce(v_inserts,0),
        'existing_exact',v_exact,'possible_duplicate',v_duplicate,'review_required',v_review,
        'inventory_allocation_eligible',false));
  return jsonb_build_object('batch_id',v_batch_id,'idempotent',false,'updates',coalesce(v_updates,0),
    'inserts',coalesce(v_inserts,0),'possible_duplicate',v_duplicate,'review_required',v_review);
end;
$$;

revoke all on function public.apply_incremental_commercial_batch(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_incremental_commercial_batch(uuid,uuid,text,text,text,jsonb) to service_role;
