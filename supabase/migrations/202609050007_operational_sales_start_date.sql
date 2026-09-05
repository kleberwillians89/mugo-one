begin;

-- ==========================================================================
-- 1. CORTE OPERACIONAL — organizations.operational_sales_start_date
-- --------------------------------------------------------------------------
-- Configuração central: a partir de qual sale_date uma organização considera
-- uma venda "operação atual". NULL = sem corte (comportamento histórico
-- inalterado — nunca afeta organizações que não configurarem isso).
-- Não apaga, não move, não altera nenhuma sale — é só um valor de referência
-- consultado por leituras operacionais. Histórico continua 100% no banco e
-- acessível via período "all"/consulta explícita.
-- ==========================================================================
alter table public.organizations add column if not exists operational_sales_start_date date;
comment on column public.organizations.operational_sales_start_date is
  'A partir de qual sale_date uma venda conta como "operação atual" nas telas operacionais. NULL = sem corte (todo o histórico é operacional, comportamento anterior preservado). Nunca filtra clients/perfumes/inventory — só leituras derivadas de sales.';

update public.organizations set operational_sales_start_date='2026-09-01'
  where id='032fd96e-638f-428b-8cc2-37afc71e10ea'; -- RUAH PARFUMS, único tenant configurado nesta mudança

create or replace function public.operational_sales_floor(p_organization_id uuid)
returns date language sql stable security definer set search_path=public as $$
  select coalesce(
    (select operational_sales_start_date from public.organizations where id=p_organization_id),
    date '1900-01-01'
  );
$$;
comment on function public.operational_sales_floor(uuid) is
  'Data mínima de sale_date para uma venda contar como operacional. Fonte única da regra — nunca hard-codar a data em RPCs individuais. Organização sem configuração = sem corte (1900-01-01, equivalente a "sempre verdadeiro").';
revoke all on function public.operational_sales_floor(uuid) from public,anon;
grant execute on function public.operational_sales_floor(uuid) to authenticated,service_role;

-- ==========================================================================
-- 2. FALTA SPLITAR — as 3 RPCs passam a considerar só o período operacional
-- --------------------------------------------------------------------------
-- Mesma assinatura, mesmo comportamento de resto (status/agrupamento/
-- paginação intactos) — só ganham "and s.sale_date >= operational_sales_floor"
-- na base CTE. Histórico de split (se algum dia for necessário) fica para um
-- projeto separado, como combinado — estas RPCs não ganham parâmetro para
-- desligar o corte.
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
    and s.sale_type='SPLIT' and s.deleted_at is null
    and s.sale_date >= public.operational_sales_floor(s.organization_id);
$$;
revoke all on function public.sale_split_status_cards() from public,anon;
grant execute on function public.sale_split_status_cards() to authenticated;

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
      and s.sale_date >= public.operational_sales_floor(s.organization_id)
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
      and s.sale_date >= public.operational_sales_floor(s.organization_id)
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

-- ==========================================================================
-- 3. COBRANÇAS + MANYCHAT — uma camada operacional compartilhada.
--    collections_pending_sales_canonical permanece intocada e continua sendo
--    a consulta do histórico completo. A camada abaixo aplica exclusivamente
--    operational_sales_floor e passa a ser a fonte tanto da tela quanto do
--    saldo customer-facing do WhatsApp.
-- ==========================================================================
create or replace function public.collections_pending_sales_operational(p_organization_id uuid)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,perfume_brand text,sale_type text,volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select pending.*
  from public.collections_pending_sales_canonical(p_organization_id) pending
  where pending.sale_date >= public.operational_sales_floor(p_organization_id);
$$;
revoke all on function public.collections_pending_sales_operational(uuid) from public,anon,authenticated;
grant execute on function public.collections_pending_sales_operational(uuid) to service_role;

create or replace function public.collections_pending_sales(p_search text default null)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,perfume_brand text,sale_type text,volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select pending.*
  from public.current_user_org_ids() as organizations(organization_id)
  cross join lateral public.collections_pending_sales_operational(organizations.organization_id) pending
  where public.has_org_permission(organizations.organization_id,'sales.view')
    and(
      coalesce(btrim(p_search),'')=''
      or pending.client_name ilike '%'||btrim(p_search)||'%'
      or pending.client_number::text ilike '%'||btrim(p_search)||'%'
      or pending.perfume_name ilike '%'||btrim(p_search)||'%'
    )
  order by pending.sale_date asc,pending.id asc;
$$;
revoke all on function public.collections_pending_sales(text) from public,anon;
grant execute on function public.collections_pending_sales(text) to authenticated;

create or replace function public.whatsapp_customer_balance_v1(p_organization_id uuid,p_normalized_phone text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  candidate_ids uuid[];
  customer public.clients;
  order_count integer;
  pending_total numeric;
begin
  if p_organization_id is null then raise exception 'organization_required'; end if;
  if p_normalized_phone is null or p_normalized_phone !~ '^55[1-9][0-9]{9,10}$' then
    return jsonb_build_object('status','invalid_phone');
  end if;
  select coalesce(array_agg(distinct c.id order by c.id),'{}'::uuid[]) into candidate_ids
  from public.clients c
  where c.organization_id=p_organization_id
    and c.deleted_at is null and c.merged_into_id is null
    and (c.normalized_whatsapp=p_normalized_phone or c.normalized_phone=p_normalized_phone);
  if cardinality(candidate_ids)=0 then return jsonb_build_object('status','not_found'); end if;
  if cardinality(candidate_ids)>1 then return jsonb_build_object('status','ambiguous'); end if;
  select * into customer from public.clients where id=candidate_ids[1] and organization_id=p_organization_id;
  select count(*)::integer,coalesce(sum(pending.amount),0)
    into order_count,pending_total
  from public.collections_pending_sales_operational(p_organization_id) pending
  where pending.client_id=customer.id;
  return jsonb_build_object('status','ok','customer_name',customer.name,
    'open_orders',order_count,'total_pending',pending_total);
end;
$$;
revoke all on function public.whatsapp_customer_balance_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_customer_balance_v1(uuid,text) to service_role;

-- ==========================================================================
-- 4. NOVO FRETE — fila de produtos reservados filtra no servidor.
-- --------------------------------------------------------------------------
-- Antes: o frontend baixava TODAS as allocations reservadas (568 hoje) e
-- filtrava em React. Substituída por uma RPC que já filtra no banco por
-- padrão (p_include_historical=false); "Mostrar histórico anterior" chama de
-- novo com p_include_historical=true. Mesmo nível de acesso de antes (leitura
-- de inventory_allocations.select já era só tenant-scoped, sem permissão
-- extra) — não restringe nem amplia quem pode ver.
-- ==========================================================================
create or replace function public.reserved_allocations_for_shipment(p_include_historical boolean default false)
returns table(
  id uuid,client_id uuid,client_name text,sale_id uuid,quantity_ml numeric,allocated_at timestamptz,
  allocation_source text,stock_managed boolean,storage_location text,
  sale_date date,amount numeric,perfume_name_raw text,sale_type text
) language sql stable security definer set search_path=public as $$
  select a.id,a.client_id,c.name,a.sale_id,a.quantity_ml,a.allocated_at,
    a.allocation_source,a.stock_managed,a.storage_location,
    s.sale_date,s.amount,s.perfume_name_raw,s.sale_type
  from public.inventory_allocations a
  join public.clients c on c.id=a.client_id
  left join public.sales s on s.id=a.sale_id
  where a.organization_id in (select public.current_user_org_ids())
    and a.status='reserved'
    and (p_include_historical or s.sale_date is null or s.sale_date >= public.operational_sales_floor(a.organization_id))
  order by a.allocated_at asc;
$$;
revoke all on function public.reserved_allocations_for_shipment(boolean) from public,anon;
grant execute on function public.reserved_allocations_for_shipment(boolean) to authenticated;

commit;
