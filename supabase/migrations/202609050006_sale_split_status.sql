begin;

-- ==========================================================================
-- 1. STATUS DE SPLIT — sales.split_status / split_completed_by
-- --------------------------------------------------------------------------
-- Controla exclusivamente o estado operacional "esta venda já foi separada
-- (splitada)?". Não é venda, pagamento, envio, prazo, preparação ou estoque
-- (fluxos totalmente independentes). Reaproveita sales.split_completed_at,
-- já existente desde 202608280001_client_number_split_completed_at.sql, em
-- vez de duplicar a informação em tabela nova: split_status e
-- split_completed_at ficam sempre sincronizados por constraint.
-- Nenhum backfill de histórico — toda venda SPLIT existente permanece
-- not_split até que um operador marque manualmente (decisão do time, não
-- suposição automática sobre o passado).
-- ==========================================================================
alter table public.sales add column if not exists split_status text not null default 'not_split';
alter table public.sales add constraint sales_split_status_valid check (split_status in ('not_split','split'));
alter table public.sales add constraint sales_split_status_requires_split_type check (split_status='not_split' or sale_type='SPLIT');
alter table public.sales add constraint sales_split_status_matches_completed_at check ((split_status='split')=(split_completed_at is not null));

alter table public.sales add column if not exists split_completed_by uuid references public.profiles(id);
alter table public.sales add constraint sales_split_completed_by_requires_split check (split_completed_by is null or split_status='split');

comment on column public.sales.split_status is
  'Estado operacional do split: not_split | split. Independente de venda, pagamento, envio, prazo e estoque. Só muda via set_sale_split_status/_bulk.';
comment on column public.sales.split_completed_by is
  'Quem marcou este split como concluído pela última vez. Null quando split_status=not_split.';

create index sales_org_split_status_idx on public.sales (organization_id, split_status)
  where deleted_at is null and sale_type = 'SPLIT';

-- ==========================================================================
-- 2. AUDITORIA — histórico completo de mudanças de status, nunca apagado
-- ==========================================================================
create table public.sale_split_status_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  previous_status text not null check (previous_status in ('not_split','split')),
  new_status text not null check (new_status in ('not_split','split')),
  changed_at timestamptz not null default now()
);
create index sale_split_status_audit_sale_idx on public.sale_split_status_audit (sale_id, changed_at desc);
create index sale_split_status_audit_org_idx on public.sale_split_status_audit (organization_id, changed_at desc);
alter table public.sale_split_status_audit enable row level security;
revoke all on table public.sale_split_status_audit from public, anon, authenticated;
create policy sale_split_status_audit_select on public.sale_split_status_audit for select to authenticated
  using (organization_id in (select public.current_user_org_ids()) and public.has_org_permission(organization_id,'sales.view'));
-- Sem policy de insert/update/delete: só alcançável via função security definer abaixo. Não há UPDATE/DELETE em lugar nenhum — histórico é append-only.

-- ==========================================================================
-- 3. set_sale_split_status — uma venda, concorrência otimista, auditoria
-- ==========================================================================
create or replace function public.set_sale_split_status(p_sale_id uuid,p_status text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare before_row public.sales; after_row public.sales; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_status not in ('not_split','split') then raise exception 'invalid_status'; end if;
  select * into before_row from public.sales
   where id=p_sale_id and organization_id in (select public.current_user_org_ids()) and deleted_at is null
   for update;
  if before_row.id is null then raise exception 'sale_not_found'; end if;
  if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'permission_denied'; end if;
  if before_row.sale_type<>'SPLIT' then raise exception 'sale_not_eligible_for_split'; end if;
  if before_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;
  if before_row.split_status=p_status then
    return jsonb_build_object('id',before_row.id,'split_status',before_row.split_status,'split_completed_at',before_row.split_completed_at,'updated_at',before_row.updated_at,'unchanged',true);
  end if;
  update public.sales set
    split_status=p_status,
    split_completed_at=case when p_status='split' then coalesce(split_completed_at,current_date) else null end,
    split_completed_by=case when p_status='split' then uid else null end,
    updated_at=now()
   where id=before_row.id returning * into after_row;
  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status)
  values (before_row.organization_id,before_row.id,uid,before_row.split_status,after_row.split_status);
  return jsonb_build_object('id',after_row.id,'split_status',after_row.split_status,'split_completed_at',after_row.split_completed_at,'updated_at',after_row.updated_at,'unchanged',false);
end;$$;
revoke all on function public.set_sale_split_status(uuid,text,timestamptz) from public,anon;
grant execute on function public.set_sale_split_status(uuid,text,timestamptz) to authenticated;

-- ==========================================================================
-- 4. set_sale_split_status_bulk — falha parcial nunca é escondida
-- --------------------------------------------------------------------------
-- Cada item roda em bloco BEGIN/EXCEPTION próprio (savepoint implícito do
-- plpgsql): um item que falha (tenant errado, sem permissão, não elegível,
-- não encontrado) é revertido isoladamente, sem desfazer os itens que já
-- tiveram sucesso nem abortar o restante do lote.
-- ==========================================================================
create or replace function public.set_sale_split_status_bulk(p_sale_ids uuid[],p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); sale_id uuid; before_row public.sales; after_row public.sales;
  updated uuid[]:=array[]::uuid[]; failed jsonb:='[]'::jsonb;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_status not in ('not_split','split') then raise exception 'invalid_status'; end if;
  if p_sale_ids is null or array_length(p_sale_ids,1) is null then raise exception 'no_sales_selected'; end if;
  foreach sale_id in array p_sale_ids loop
    begin
      select * into before_row from public.sales
       where id=sale_id and organization_id in (select public.current_user_org_ids()) and deleted_at is null
       for update;
      if before_row.id is null then raise exception 'sale_not_found'; end if;
      if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'permission_denied'; end if;
      if before_row.sale_type<>'SPLIT' then raise exception 'sale_not_eligible_for_split'; end if;
      if before_row.split_status<>p_status then
        update public.sales set
          split_status=p_status,
          split_completed_at=case when p_status='split' then coalesce(split_completed_at,current_date) else null end,
          split_completed_by=case when p_status='split' then uid else null end,
          updated_at=now()
         where id=before_row.id returning * into after_row;
        insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status)
        values (before_row.organization_id,before_row.id,uid,before_row.split_status,after_row.split_status);
      end if;
      updated:=array_append(updated,sale_id);
    exception when others then
      failed:=failed||jsonb_build_object('sale_id',sale_id,'reason',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated',to_jsonb(updated),'updated_count',coalesce(array_length(updated,1),0),'failed',failed,'failed_count',jsonb_array_length(failed));
end;$$;
revoke all on function public.set_sale_split_status_bulk(uuid[],text) from public,anon;
grant execute on function public.set_sale_split_status_bulk(uuid[],text) to authenticated;

-- ==========================================================================
-- 5. Cards do topo — sempre globais (não seguem os filtros da tabela)
-- ==========================================================================
create or replace function public.sale_split_status_cards()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'not_split', count(*) filter (where s.split_status='not_split'),
    'split_today', count(*) filter (where s.split_status='split' and s.split_completed_at=current_date),
    'clients_pending', count(distinct s.client_id) filter (where s.split_status='not_split'),
    'perfumes_pending', count(distinct s.perfume_id) filter (where s.split_status='not_split'),
    'ml_pending', coalesce(sum(s.volume_ml) filter (where s.split_status='not_split'),0)
  )
  from public.sales s
  where s.organization_id in (select public.current_user_org_ids())
    and public.has_org_permission(s.organization_id,'sales.view')
    and s.sale_type='SPLIT' and s.deleted_at is null;
$$;
revoke all on function public.sale_split_status_cards() from public,anon;
grant execute on function public.sale_split_status_cards() to authenticated;

-- ==========================================================================
-- 6. Resumo agrupado por perfume ("PERFUMES QUE FALTAM SPLITAR")
-- ==========================================================================
create or replace function public.sale_split_status_perfume_summary(p_status text default 'not_split',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if p_status not in ('not_split','split','split_today','all') then raise exception 'invalid_status_filter'; end if;
  with base as (
    select s.id,s.client_id,s.perfume_id,p.full_name_raw as perfume_name,p.brand_house,s.volume_ml
    from public.sales s
    join public.clients c on c.id=s.client_id
    left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id in (select public.current_user_org_ids())
      and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type='SPLIT' and s.deleted_at is null
      and (p_status='all' or (p_status='not_split' and s.split_status='not_split') or (p_status='split' and s.split_status='split') or (p_status='split_today' and s.split_status='split' and s.split_completed_at=current_date))
      and (nullif(p_filters->>'search','') is null or c.name ilike '%'||(p_filters->>'search')||'%' or p.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or c.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or p.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or p.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or s.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or s.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
  ), grouped as (
    select perfume_id,max(perfume_name) as perfume_name,max(brand_house) as brand_house,
      count(distinct client_id) as clients_count, count(*) as items_count, coalesce(sum(volume_ml),0) as ml_total
    from base group by perfume_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('perfume_id',perfume_id,'perfume_name',coalesce(perfume_name,'(sem perfume)'),'brand_house',brand_house,'clients_count',clients_count,'items_count',items_count,'ml_total',ml_total) order by items_count desc),'[]'::jsonb)
  into result from grouped;
  return result;
end;$$;
revoke all on function public.sale_split_status_perfume_summary(text,jsonb) from public,anon;
grant execute on function public.sale_split_status_perfume_summary(text,jsonb) to authenticated;

-- ==========================================================================
-- 7. Lista paginada de itens — detalhe de um perfume, "TODOS", ou impressão
--    por seleção explícita (p_sale_ids ignora o filtro de status: imprime
--    exatamente o que foi selecionado, qualquer que seja o status atual).
-- ==========================================================================
create or replace function public.sale_split_status_list(p_perfume_id uuid default null,p_status text default 'not_split',p_filters jsonb default '{}'::jsonb,p_sale_ids uuid[] default null,p_page integer default 0,p_page_size integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; limit_size integer:=least(greatest(p_page_size,1),500); offset_size integer:=greatest(p_page,0)*limit_size;
begin
  if p_status not in ('not_split','split','split_today','all') then raise exception 'invalid_status_filter'; end if;
  with base as (
    select s.id,s.client_id,c.name as client_name,c.client_number,s.perfume_id,p.full_name_raw as perfume_name,p.brand_house,
      s.bottle_identifier,s.volume_ml,s.sale_date,s.split_status,s.split_completed_at,s.split_completed_by,s.updated_at
    from public.sales s
    join public.clients c on c.id=s.client_id
    left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id in (select public.current_user_org_ids())
      and public.has_org_permission(s.organization_id,'sales.view')
      and s.sale_type='SPLIT' and s.deleted_at is null
      and (p_perfume_id is null or s.perfume_id=p_perfume_id)
      and (p_sale_ids is null or s.id=any(p_sale_ids))
      and (p_sale_ids is not null or p_status='all' or (p_status='not_split' and s.split_status='not_split') or (p_status='split' and s.split_status='split') or (p_status='split_today' and s.split_status='split' and s.split_completed_at=current_date))
      and (nullif(p_filters->>'search','') is null or c.name ilike '%'||(p_filters->>'search')||'%' or p.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or c.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or p.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or p.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or s.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or s.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
  ), counted as (select *,count(*) over() as total_count from base),
  windowed as (select * from counted order by client_name, id limit limit_size offset offset_size)
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(windowed)-'total_count'),'[]'::jsonb),'total',coalesce(max(total_count),0))
  into result from windowed;
  return coalesce(result,jsonb_build_object('rows','[]'::jsonb,'total',0));
end;$$;
revoke all on function public.sale_split_status_list(uuid,text,jsonb,uuid[],integer,integer) from public,anon;
grant execute on function public.sale_split_status_list(uuid,text,jsonb,uuid[],integer,integer) to authenticated;

commit;
