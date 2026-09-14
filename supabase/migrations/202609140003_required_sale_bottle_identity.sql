begin;

-- Gabriel separa por frasco físico. Frascos diferentes do mesmo perfume não
-- podem ficar somados no mesmo card da fila.
create or replace function public.sale_split_status_perfume_summary(p_status text default 'not_split',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if p_status not in('not_split','split','split_today','all') then raise exception 'invalid_status_filter'; end if;
  with base as(
    select s.id,s.sale_type,s.client_id,s.perfume_id,p.full_name_raw perfume_name,p.brand_house,s.bottle_identifier,s.volume_ml,
      case when s.sale_type='APC' then s.apc_separation_status else s.split_status end separation_status,
      case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end separated_at
    from public.sales s join public.clients c on c.id=s.client_id left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id in(select public.current_user_org_ids()) and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type in('SPLIT','APC') and s.deleted_at is null and s.sale_date>=public.operational_sales_floor(s.organization_id)
      and (nullif(p_filters->>'sale_type','') is null or s.sale_type=p_filters->>'sale_type')
      and (p_status='all' or (p_status='not_split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='not_split') or (p_status='split' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split') or (p_status='split_today' and (case when s.sale_type='APC' then s.apc_separation_status else s.split_status end)='split' and (case when s.sale_type='APC' then s.apc_separated_at else s.split_completed_at end)=current_date))
      and (nullif(p_filters->>'search','') is null or c.name ilike '%'||(p_filters->>'search')||'%' or p.full_name_raw ilike '%'||(p_filters->>'search')||'%' or s.bottle_identifier ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or c.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or p.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or p.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or s.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or s.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
  ),grouped as(
    select sale_type,perfume_id,bottle_identifier,max(perfume_name) perfume_name,max(brand_house) brand_house,count(distinct client_id) clients_count,count(*) items_count,coalesce(sum(volume_ml),0) ml_total
    from base group by sale_type,perfume_id,bottle_identifier
  ) select coalesce(jsonb_agg(jsonb_build_object('sale_type',sale_type,'perfume_id',perfume_id,'perfume_name',coalesce(perfume_name,'(sem perfume)'),'brand_house',brand_house,'bottle_identifier',bottle_identifier,'clients_count',clients_count,'items_count',items_count,'ml_total',ml_total) order by case when sale_type='APC' then 0 else 1 end,perfume_name,bottle_identifier),'[]'::jsonb)
  into result from grouped;
  return result;
end;$$;
revoke all on function public.sale_split_status_perfume_summary(text,jsonb) from public,anon;
grant execute on function public.sale_split_status_perfume_summary(text,jsonb) to authenticated;

-- A identidade de frasco fica no campo dedicado e também no nome operacional
-- da venda criada pelo Davi. Assim qualquer tela antiga que mostre somente o
-- nome continua exibindo “(FRASCO 1)”, “(FRASCO 2)” ou “(FRASCO 3)”.
create or replace function public.normalize_davi_sale_bottle_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.source not in('ai_sales_batch','davi_excel') then return new; end if;
  if new.source='davi_excel' and (new.bottle_identifier is null or new.bottle_identifier !~ '^FRASCO [1-3]$') then
    raise exception 'bottle_number_required';
  end if;
  if new.bottle_identifier is not null then
    if new.bottle_identifier !~ '^FRASCO [1-3]$' then raise exception 'invalid_bottle_number'; end if;
    new.perfume_name_raw:=btrim(regexp_replace(coalesce(new.perfume_name_raw,new.perfume_base_name,''),'\s*\(\s*FRASCO\s+[0-9]+\s*\)\s*$','','i'))||' ('||new.bottle_identifier||')';
  end if;
  return new;
end;$$;

drop trigger if exists normalize_davi_sale_bottle_identity on public.sales;
create trigger normalize_davi_sale_bottle_identity
before insert or update of bottle_identifier,perfume_name_raw on public.sales
for each row execute function public.normalize_davi_sale_bottle_identity();

notify pgrst,'reload schema';
commit;
