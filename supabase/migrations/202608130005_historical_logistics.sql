create table public.historical_logistics_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_file text not null,
  source_hash text not null,
  source_snapshot text not null,
  deterministic_rows integer not null,
  updated_sales integer not null default 0,
  shipped_at_added integer not null default 0,
  deadline_date_added integer not null default 0,
  deadline_raw_added integer not null default 0,
  status_added integer not null default 0,
  actor_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(organization_id,source_hash)
);
create table public.historical_logistics_change_log (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.historical_logistics_imports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  source_row integer not null,
  before_data jsonb not null,
  applied_data jsonb not null,
  created_at timestamptz not null default now(),
  unique(import_id,sale_id)
);
alter table public.historical_logistics_imports enable row level security;
alter table public.historical_logistics_change_log enable row level security;
create policy historical_logistics_imports_select on public.historical_logistics_imports for select using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
create policy historical_logistics_change_log_select on public.historical_logistics_change_log for select using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
revoke insert,update,delete on public.historical_logistics_imports from authenticated;
revoke insert,update,delete on public.historical_logistics_change_log from authenticated;

create or replace function public.apply_historical_logistics_batch(
  p_organization_id uuid,p_user_id uuid,p_source_file text,p_source_hash text,
  p_source_snapshot text,p_rows jsonb,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_import uuid;v_existing public.historical_logistics_imports;v_count integer;v_ship integer:=0;v_date integer:=0;v_raw integer:=0;v_status integer:=0;r record;v_sale public.sales;v_patch jsonb;v_before jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin') then raise exception 'administrator_membership_required'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'rows_must_be_array'; end if;
  select * into v_existing from public.historical_logistics_imports where organization_id=p_organization_id and source_hash=p_source_hash;
  if found then return jsonb_build_object('import_id',v_existing.id,'idempotent',true,'updated_sales',0); end if;
  select count(*) into v_count from jsonb_array_elements(p_rows);
  if v_count=0 or exists(select 1 from jsonb_array_elements(p_rows) x where nullif(x->>'sale_id','') is null or jsonb_object_length(coalesce(x->'proposed','{}'))=0) then raise exception 'invalid_deterministic_rows'; end if;
  insert into public.historical_logistics_imports(organization_id,source_file,source_hash,source_snapshot,deterministic_rows,actor_id,metadata)
    values(p_organization_id,p_source_file,p_source_hash,p_source_snapshot,v_count,p_user_id,p_metadata) returning id into v_import;
  for r in select value item from jsonb_array_elements(p_rows) loop
    select * into v_sale from public.sales where id=(r.item->>'sale_id')::uuid and organization_id=p_organization_id and deleted_at is null for update;
    if not found then raise exception 'sale_match_missing'; end if;
    v_patch:=r.item->'proposed';
    if (v_patch?'shipped_at' and v_sale.shipped_at is not null) or (v_patch?'shipping_deadline_date' and v_sale.shipping_deadline_date is not null) or (v_patch?'shipping_deadline_raw' and v_sale.shipping_deadline_raw is not null) or (v_patch?'shipping_operational_status' and v_sale.shipping_operational_status is not null) then raise exception 'logistics_field_no_longer_empty'; end if;
    v_before:=jsonb_build_object('shipped_at',v_sale.shipped_at,'shipping_deadline_date',v_sale.shipping_deadline_date,'shipping_deadline_raw',v_sale.shipping_deadline_raw,'shipping_operational_status',v_sale.shipping_operational_status);
    update public.sales set
      shipped_at=case when v_patch?'shipped_at' then (v_patch->>'shipped_at')::date else shipped_at end,
      shipping_deadline_date=case when v_patch?'shipping_deadline_date' then (v_patch->>'shipping_deadline_date')::date else shipping_deadline_date end,
      shipping_deadline_raw=case when v_patch?'shipping_deadline_raw' then v_patch->>'shipping_deadline_raw' else shipping_deadline_raw end,
      shipping_operational_status=case when v_patch?'shipping_operational_status' then v_patch->>'shipping_operational_status' else shipping_operational_status end,
      updated_at=now() where id=v_sale.id;
    insert into public.historical_logistics_change_log(import_id,organization_id,sale_id,source_row,before_data,applied_data) values(v_import,p_organization_id,v_sale.id,(r.item->>'source_row')::integer,v_before,v_patch);
    v_ship:=v_ship+(v_patch?'shipped_at')::integer;v_date:=v_date+(v_patch?'shipping_deadline_date')::integer;v_raw:=v_raw+(v_patch?'shipping_deadline_raw')::integer;v_status:=v_status+(v_patch?'shipping_operational_status')::integer;
  end loop;
  update public.historical_logistics_imports set updated_sales=v_count,shipped_at_added=v_ship,deadline_date_added=v_date,deadline_raw_added=v_raw,status_added=v_status where id=v_import;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,p_user_id,'historical_logistics_applied','historical_logistics_import',v_import::text,jsonb_build_object('updated_sales',v_count,'shipped_at_added',v_ship,'deadline_date_added',v_date,'deadline_raw_added',v_raw,'status_added',v_status,'sales_inserted',0,'shipments_created',0));
  return jsonb_build_object('import_id',v_import,'idempotent',false,'updated_sales',v_count,'shipped_at_added',v_ship,'deadline_date_added',v_date,'deadline_raw_added',v_raw,'status_added',v_status);
end;$$;
revoke all on function public.apply_historical_logistics_batch(uuid,uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_historical_logistics_batch(uuid,uuid,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.logistics_operational_summary(org_id uuid,start_date date,end_date date) returns jsonb
language sql stable security invoker set search_path=public as $$
with historic as (select * from public.sales where organization_id=org_id and deleted_at is null and sale_date between start_date and end_date), operational as (select * from public.shipments where organization_id=org_id), allocation_backlog as (select count(distinct sale_id) n from public.inventory_allocations where organization_id=org_id and status in('reserved','shipping'))
select jsonb_build_object(
  'identified_shipments',count(*) filter(where shipped_at is not null),
  'shipped_in_period',count(*) filter(where shipped_at between start_date and end_date),
  'historical_on_time',count(*) filter(where shipped_at is not null and shipping_deadline_date is not null and shipped_at<=shipping_deadline_date),
  'historical_late',count(*) filter(where shipped_at is not null and shipping_deadline_date is not null and shipped_at>shipping_deadline_date),
  'average_days_to_ship',round(avg(shipped_at-sale_date) filter(where shipped_at is not null),2),
  'operational_backlog',(select n from allocation_backlog),
  'shipments_preparing',(select count(*) from operational where status in('draft','requested')),
  'awaiting_approval',(select count(*) from operational where status='awaiting_customer_approval'),
  'labels_released',(select count(*) from operational where status='label_released'),
  'posted',(select count(*) from operational where status='posted'),
  'delivered',(select count(*) from operational where status='delivered')
) from historic;$$;
revoke all on function public.logistics_operational_summary(uuid,date,date) from public,anon;
grant execute on function public.logistics_operational_summary(uuid,date,date) to authenticated,service_role;

create or replace function public.ai_authorized_aggregates(org_id uuid,start_date date,end_date date) returns jsonb
language sql stable security invoker set search_path=public as $$
select public.commercial_period_summary(org_id,start_date,end_date)-'daily'||jsonb_build_object('logistics',public.logistics_operational_summary(org_id,start_date,end_date),'data_source','Supabase RUAH - agregados autorizados','generated_at',now(),'timezone','America/Sao_Paulo');$$;
revoke all on function public.ai_authorized_aggregates(uuid,date,date) from public,anon;
grant execute on function public.ai_authorized_aggregates(uuid,date,date) to authenticated,service_role;
