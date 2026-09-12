begin;

-- Gabriel's separation queue starts only after payment. SPLIT keeps its
-- historical split fields; APC gets an independent completion field so an
-- original-bottle separation is never recorded as a decant split.
alter table public.sales add column if not exists apc_separation_status text not null default 'not_split';
alter table public.sales add column if not exists apc_separated_at date;
alter table public.sales add column if not exists apc_separated_by uuid references public.profiles(id);
alter table public.sales add constraint sales_apc_separation_status_valid check (apc_separation_status in ('not_split','split'));
alter table public.sales add constraint sales_apc_separation_requires_apc check (apc_separation_status='not_split' or sale_type='APC');
alter table public.sales add constraint sales_apc_separation_matches_date check ((apc_separation_status='split')=(apc_separated_at is not null));
alter table public.sales add constraint sales_apc_separated_by_requires_completion check (apc_separated_by is null or apc_separation_status='split');

comment on column public.sales.apc_separation_status is 'Separação operacional do frasco original APC: not_split | split.';
comment on column public.sales.apc_separated_at is 'Data em que o frasco original APC foi separado por Gabriel.';

create index sales_org_apc_separation_status_idx on public.sales (organization_id,apc_separation_status)
  where deleted_at is null and sale_type='APC' and payment_status='paid';

create or replace function public.set_sale_split_status(p_sale_id uuid,p_status text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare before_row public.sales; after_row public.sales; uid uuid:=auth.uid(); previous_status text;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_status not in ('not_split','split') then raise exception 'invalid_status'; end if;
  select * into before_row from public.sales
   where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null
   for update;
  if before_row.id is null then raise exception 'sale_not_found'; end if;
  if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'permission_denied'; end if;
  if before_row.sale_type not in('SPLIT','APC') then raise exception 'sale_not_eligible_for_separation'; end if;
  if before_row.payment_status<>'paid' then raise exception 'sale_not_paid_for_separation'; end if;
  if before_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;
  previous_status:=case when before_row.sale_type='APC' then before_row.apc_separation_status else before_row.split_status end;
  if previous_status=p_status then
    return jsonb_build_object('id',before_row.id,'split_status',previous_status,'split_completed_at',case when before_row.sale_type='APC' then before_row.apc_separated_at else before_row.split_completed_at end,'updated_at',before_row.updated_at,'unchanged',true);
  end if;
  update public.sales set
    split_status=case when sale_type='SPLIT' then p_status else split_status end,
    split_completed_at=case when sale_type='SPLIT' and p_status='split' then coalesce(split_completed_at,current_date) when sale_type='SPLIT' then null else split_completed_at end,
    split_completed_by=case when sale_type='SPLIT' and p_status='split' then uid when sale_type='SPLIT' then null else split_completed_by end,
    apc_separation_status=case when sale_type='APC' then p_status else apc_separation_status end,
    apc_separated_at=case when sale_type='APC' and p_status='split' then coalesce(apc_separated_at,current_date) when sale_type='APC' then null else apc_separated_at end,
    apc_separated_by=case when sale_type='APC' and p_status='split' then uid when sale_type='APC' then null else apc_separated_by end,
    updated_at=now()
   where id=before_row.id returning * into after_row;
  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status)
  values(before_row.organization_id,before_row.id,uid,previous_status,p_status);
  return jsonb_build_object('id',after_row.id,'split_status',p_status,'split_completed_at',case when after_row.sale_type='APC' then after_row.apc_separated_at else after_row.split_completed_at end,'updated_at',after_row.updated_at,'unchanged',false);
end;$$;

create or replace function public.set_sale_split_status_bulk(p_sale_ids uuid[],p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); requested_count integer; locked_count integer;
  changed_ids uuid[]:=array[]::uuid[]; changed_at timestamptz:=now();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_status<>'split' then raise exception 'bulk_split_undo_not_allowed'; end if;
  if p_sale_ids is null or array_length(p_sale_ids,1) is null then raise exception 'no_sales_selected'; end if;
  select count(distinct id) into requested_count from unnest(p_sale_ids) selected(id);
  perform 1 from public.sales sale
  where sale.id=any(p_sale_ids)
    and sale.organization_id in(select public.current_user_org_ids())
    and public.has_org_permission(sale.organization_id,'sales.edit')
    and sale.deleted_at is null and sale.sale_type in('SPLIT','APC') and sale.payment_status='paid'
  for update;
  get diagnostics locked_count=row_count;
  if locked_count<>requested_count then raise exception 'bulk_separation_selection_not_eligible'; end if;

  with changed as(
    update public.sales sale set
      split_status=case when sale.sale_type='SPLIT' then 'split' else sale.split_status end,
      split_completed_at=case when sale.sale_type='SPLIT' then coalesce(sale.split_completed_at,current_date) else sale.split_completed_at end,
      split_completed_by=case when sale.sale_type='SPLIT' then uid else sale.split_completed_by end,
      apc_separation_status=case when sale.sale_type='APC' then 'split' else sale.apc_separation_status end,
      apc_separated_at=case when sale.sale_type='APC' then coalesce(sale.apc_separated_at,current_date) else sale.apc_separated_at end,
      apc_separated_by=case when sale.sale_type='APC' then uid else sale.apc_separated_by end,
      updated_at=changed_at
    where sale.id=any(p_sale_ids) and sale.deleted_at is null and sale.payment_status='paid'
      and ((sale.sale_type='SPLIT' and sale.split_status='not_split') or (sale.sale_type='APC' and sale.apc_separation_status='not_split'))
    returning sale.id,sale.organization_id
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into changed_ids from changed;
  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status,changed_at)
  select sale.organization_id,sale.id,uid,'not_split','split',changed_at from public.sales sale where sale.id=any(changed_ids);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  select sale.organization_id,uid,'bulk_separation_completed','sales',null,jsonb_build_object('count',count(*),'sale_ids',jsonb_agg(sale.id order by sale.id),'completed_at',changed_at)
  from public.sales sale where sale.id=any(changed_ids) group by sale.organization_id;
  return jsonb_build_object('updated',to_jsonb(changed_ids),'updated_count',cardinality(changed_ids),'completed_at',changed_at);
end;$$;

create or replace function public.complete_sale_splits_for_filter(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); changed_ids uuid[]:=array[]::uuid[]; changed_at timestamptz:=now();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  with eligible as(
    select sale.id
    from public.sales sale
    join public.clients client on client.id=sale.client_id
    left join public.perfumes perfume on perfume.id=sale.perfume_id
    where sale.organization_id in(select public.current_user_org_ids())
      and public.has_org_permission(sale.organization_id,'sales.edit')
      and sale.sale_type in('SPLIT','APC') and sale.payment_status='paid' and sale.deleted_at is null
      and ((sale.sale_type='SPLIT' and sale.split_status='not_split') or (sale.sale_type='APC' and sale.apc_separation_status='not_split'))
      and (nullif(p_filters->>'sale_type','') is null or sale.sale_type=p_filters->>'sale_type')
      and (nullif(p_filters->>'search','') is null or client.name ilike '%'||(p_filters->>'search')||'%' or perfume.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or client.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or perfume.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or perfume.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or sale.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or sale.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
    order by sale.id for update of sale
  ), changed as(
    update public.sales sale set
      split_status=case when sale.sale_type='SPLIT' then 'split' else sale.split_status end,
      split_completed_at=case when sale.sale_type='SPLIT' then current_date else sale.split_completed_at end,
      split_completed_by=case when sale.sale_type='SPLIT' then uid else sale.split_completed_by end,
      apc_separation_status=case when sale.sale_type='APC' then 'split' else sale.apc_separation_status end,
      apc_separated_at=case when sale.sale_type='APC' then current_date else sale.apc_separated_at end,
      apc_separated_by=case when sale.sale_type='APC' then uid else sale.apc_separated_by end,
      updated_at=changed_at
    from eligible where sale.id=eligible.id returning sale.id,sale.organization_id
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into changed_ids from changed;
  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status,changed_at)
  select sale.organization_id,sale.id,uid,'not_split','split',changed_at from public.sales sale where sale.id=any(changed_ids);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  select sale.organization_id,uid,'bulk_separation_completed','sales',null,jsonb_build_object('count',count(*),'sale_ids',jsonb_agg(sale.id order by sale.id),'completed_at',changed_at,'filters',p_filters)
  from public.sales sale where sale.id=any(changed_ids) group by sale.organization_id;
  return jsonb_build_object('updated',to_jsonb(changed_ids),'updated_count',cardinality(changed_ids),'completed_at',changed_at);
end;$$;

create or replace function public.sale_split_status_cards()
returns jsonb language sql stable security definer set search_path=public as $$
  with eligible as(
    select s.*,case when s.sale_type='APC' then s.apc_separation_status else s.split_status end as separation_status,
      case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end as separated_at
    from public.sales s
    where s.organization_id in(select public.current_user_org_ids())
      and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type in('SPLIT','APC') and s.payment_status='paid' and s.deleted_at is null
      and s.sale_date>=public.operational_sales_floor(s.organization_id)
  ) select jsonb_build_object(
    'not_split',count(*) filter(where separation_status='not_split'),
    'split_pending',count(*) filter(where sale_type='SPLIT' and separation_status='not_split'),
    'apc_pending',count(*) filter(where sale_type='APC' and separation_status='not_split'),
    'split_today',count(*) filter(where separation_status='split' and separated_at=current_date),
    'clients_pending',count(distinct client_id) filter(where separation_status='not_split'),
    'perfumes_pending',count(distinct perfume_id) filter(where separation_status='not_split'),
    'ml_pending',coalesce(sum(volume_ml) filter(where separation_status='not_split'),0)
  ) from eligible;
$$;

create or replace function public.sale_split_status_perfume_summary(p_status text default 'not_split',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if p_status not in('not_split','split','split_today','all') then raise exception 'invalid_status_filter'; end if;
  with base as(
    select s.id,s.sale_type,s.client_id,s.perfume_id,p.full_name_raw perfume_name,p.brand_house,s.volume_ml,
      case when s.sale_type='APC' then s.apc_separation_status else s.split_status end separation_status,
      case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end separated_at
    from public.sales s join public.clients c on c.id=s.client_id left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id in(select public.current_user_org_ids()) and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type in('SPLIT','APC') and s.payment_status='paid' and s.deleted_at is null
      and s.sale_date>=public.operational_sales_floor(s.organization_id)
      and (nullif(p_filters->>'sale_type','') is null or s.sale_type=p_filters->>'sale_type')
      and (p_status='all' or (p_status='not_split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='not_split') or (p_status='split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split') or (p_status='split_today' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split' and (case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end)=current_date))
      and (nullif(p_filters->>'search','') is null or c.name ilike '%'||(p_filters->>'search')||'%' or p.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or c.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or p.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or p.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or s.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or s.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
  ),grouped as(
    select sale_type,perfume_id,max(perfume_name) perfume_name,max(brand_house) brand_house,count(distinct client_id) clients_count,count(*) items_count,coalesce(sum(volume_ml),0) ml_total
    from base group by sale_type,perfume_id
  ) select coalesce(jsonb_agg(jsonb_build_object('sale_type',sale_type,'perfume_id',perfume_id,'perfume_name',coalesce(perfume_name,'(sem perfume)'),'brand_house',brand_house,'clients_count',clients_count,'items_count',items_count,'ml_total',ml_total) order by case when sale_type='APC' then 0 else 1 end,items_count desc),'[]'::jsonb)
  into result from grouped;
  return result;
end;$$;

create or replace function public.sale_split_status_list(p_perfume_id uuid default null,p_status text default 'not_split',p_filters jsonb default '{}'::jsonb,p_sale_ids uuid[] default null,p_page integer default 0,p_page_size integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;limit_size integer:=least(greatest(p_page_size,1),500);offset_size integer:=greatest(p_page,0)*limit_size;
begin
  if p_status not in('not_split','split','split_today','all') then raise exception 'invalid_status_filter'; end if;
  with base as(
    select s.id,s.sale_type,s.payment_status,s.client_id,c.name client_name,c.client_number,s.perfume_id,p.full_name_raw perfume_name,p.brand_house,s.bottle_identifier,s.volume_ml,s.sale_date,
      case when s.sale_type='APC' then s.apc_separation_status else s.split_status end split_status,
      case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end split_completed_at,
      case when s.sale_type='APC' then s.apc_separated_by else s.split_completed_by end split_completed_by,s.updated_at
    from public.sales s join public.clients c on c.id=s.client_id left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id in(select public.current_user_org_ids()) and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type in('SPLIT','APC') and s.payment_status='paid' and s.deleted_at is null
      and s.sale_date>=public.operational_sales_floor(s.organization_id)
      and (p_perfume_id is null or s.perfume_id=p_perfume_id)
      and (nullif(p_filters->>'sale_type','') is null or s.sale_type=p_filters->>'sale_type')
      and (p_sale_ids is null or s.id=any(p_sale_ids))
      and (p_sale_ids is not null or p_status='all' or (p_status='not_split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='not_split') or (p_status='split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split') or (p_status='split_today' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split' and (case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end)=current_date))
      and (nullif(p_filters->>'search','') is null or c.name ilike '%'||(p_filters->>'search')||'%' or p.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or c.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or p.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or p.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or s.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or s.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
  ),counted as(select *,count(*) over() total_count from base),windowed as(select * from counted order by sale_type,client_name,id limit limit_size offset offset_size)
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(windowed)-'total_count'),'[]'::jsonb),'total',coalesce(max(total_count),0)) into result from windowed;
  return coalesce(result,jsonb_build_object('rows','[]'::jsonb,'total',0));
end;$$;

revoke all on function public.set_sale_split_status(uuid,text,timestamptz) from public,anon;
grant execute on function public.set_sale_split_status(uuid,text,timestamptz) to authenticated;
revoke all on function public.set_sale_split_status_bulk(uuid[],text) from public,anon;
grant execute on function public.set_sale_split_status_bulk(uuid[],text) to authenticated;
revoke all on function public.complete_sale_splits_for_filter(jsonb) from public,anon;
grant execute on function public.complete_sale_splits_for_filter(jsonb) to authenticated;
revoke all on function public.sale_split_status_cards() from public,anon;
grant execute on function public.sale_split_status_cards() to authenticated;
revoke all on function public.sale_split_status_perfume_summary(text,jsonb) from public,anon;
grant execute on function public.sale_split_status_perfume_summary(text,jsonb) to authenticated;
revoke all on function public.sale_split_status_list(uuid,text,jsonb,uuid[],integer,integer) from public,anon;
grant execute on function public.sale_split_status_list(uuid,text,jsonb,uuid[],integer,integer) to authenticated;

commit;
