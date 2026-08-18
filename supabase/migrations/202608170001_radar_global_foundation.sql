-- RADAR GLOBAL: fundacao do modulo de radar de abastecimento (isolado do core operacional).
-- Nao altera vendas, importacao IA, inventory_allocations, shipments, SuperFrete, conferencia
-- ou qualquer migration ja aplicada. Somente tabelas/funcoes novas com prefixo radar_.

create table public.radar_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  domain text,
  country_code text check(country_code is null or country_code ~ '^[A-Z]{2}$'),
  source_type text not null default 'manual'
    check(source_type in('official_brand','authorized_retailer','retailer','distributor','marketplace','manual')),
  priority integer not null default 0,
  trusted boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index radar_sources_org_domain_idx on public.radar_sources(organization_id,domain) where domain is not null;

create table public.radar_watchlist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  perfume_id uuid references public.perfumes(id),
  brand text not null,
  perfume_name text not null,
  size_ml numeric(10,2) check(size_ml is null or size_ml>0),
  target_price_brl numeric(14,2) check(target_price_brl is null or target_price_brl>=0),
  priority text not null default 'normal' check(priority in('low','normal','high')),
  status text not null default 'active' check(status in('active','paused')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_search_at timestamptz
);
create index radar_watchlist_org_idx on public.radar_watchlist(organization_id,status);

create table public.radar_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  perfume_id uuid references public.perfumes(id),
  watch_item_id uuid references public.radar_watchlist(id) on delete set null,
  source_id uuid references public.radar_sources(id) on delete set null,
  seller_name text,
  domain text,
  url text not null check(url ~* '^https?://'),
  url_key text generated always as (lower(regexp_replace(btrim(url),'#.*$',''))) stored,
  country_code text check(country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text,
  raw_title text,
  price_native numeric(14,2) not null check(price_native>=0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  price_brl numeric(14,2) check(price_brl is null or price_brl>=0),
  size_ml numeric(10,2) check(size_ml is null or size_ml>0),
  concentration text,
  availability_status text not null default 'unknown'
    check(availability_status in('in_stock','low_stock','out_of_stock','preorder','unknown')),
  shipping_to_brazil text not null default 'unknown' check(shipping_to_brazil in('yes','no','unknown')),
  shipping_notes text,
  source_type text,
  confidence_score numeric(5,2) check(confidence_score is null or(confidence_score>=0 and confidence_score<=100)),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  active boolean not null default true,
  metadata jsonb not null default '{}',
  entry_method text not null default 'manual' check(entry_method in('manual','provider')),
  created_by uuid references public.profiles(id)
);
create unique index radar_offers_org_urlkey_idx on public.radar_offers(organization_id,url_key);
create index radar_offers_perfume_idx on public.radar_offers(organization_id,perfume_id) where active;
create index radar_offers_watch_idx on public.radar_offers(organization_id,watch_item_id) where active;

create table public.radar_offer_snapshots (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.radar_offers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  price_native numeric(14,2) not null,
  currency text not null,
  availability_status text not null,
  checked_at timestamptz not null default now()
);
create index radar_offer_snapshots_offer_idx on public.radar_offer_snapshots(offer_id,checked_at desc);

create table public.radar_search_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  watch_item_id uuid references public.radar_watchlist(id) on delete set null,
  run_type text not null default 'search' check(run_type in('search','summary')),
  query text,
  provider text,
  status text not null check(status in('running','completed','failed','not_configured')),
  error_code text,
  request_hash text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index radar_search_runs_org_idx on public.radar_search_runs(organization_id,created_at desc);

-- Row level security -------------------------------------------------------

alter table public.radar_sources enable row level security;
alter table public.radar_watchlist enable row level security;
alter table public.radar_offers enable row level security;
alter table public.radar_offer_snapshots enable row level security;
alter table public.radar_search_runs enable row level security;

create policy radar_sources_select on public.radar_sources for select
  using(organization_id in(select public.current_user_org_ids()));
create policy radar_sources_write on public.radar_sources for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));

create policy radar_watchlist_select on public.radar_watchlist for select
  using(organization_id in(select public.current_user_org_ids()));
create policy radar_watchlist_write on public.radar_watchlist for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

create policy radar_offers_select on public.radar_offers for select
  using(organization_id in(select public.current_user_org_ids()));
create policy radar_offers_update on public.radar_offers for update
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

create policy radar_offer_snapshots_select on public.radar_offer_snapshots for select
  using(organization_id in(select public.current_user_org_ids()));

create policy radar_search_runs_select on public.radar_search_runs for select
  using(organization_id in(select public.current_user_org_ids()));
create policy radar_search_runs_insert on public.radar_search_runs for insert
  with check(organization_id in(select public.current_user_org_ids()) and user_id=auth.uid());
create policy radar_search_runs_update_own on public.radar_search_runs for update
  using(user_id=auth.uid() and organization_id in(select public.current_user_org_ids()))
  with check(user_id=auth.uid() and organization_id in(select public.current_user_org_ids()));

grant select,insert,update on public.radar_sources to authenticated;
grant select,insert,update on public.radar_watchlist to authenticated;
grant select,update on public.radar_offers to authenticated;
grant select on public.radar_offer_snapshots to authenticated;
grant select,insert,update on public.radar_search_runs to authenticated;
revoke insert,delete on public.radar_offers from authenticated;
revoke insert,update,delete on public.radar_offer_snapshots from authenticated;
revoke delete on public.radar_search_runs from authenticated;

-- Historico automatico de preco/disponibilidade -----------------------------

create or replace function public.radar_offer_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT'
    or new.price_native is distinct from old.price_native
    or new.currency is distinct from old.currency
    or new.availability_status is distinct from old.availability_status then
    insert into public.radar_offer_snapshots(offer_id,organization_id,price_native,currency,availability_status,checked_at)
    values(new.id,new.organization_id,new.price_native,new.currency,new.availability_status,coalesce(new.last_checked_at,now()));
  end if;
  return new;
end $$;
create trigger radar_offer_snapshot_ins after insert on public.radar_offers for each row execute function public.radar_offer_snapshot();
create trigger radar_offer_snapshot_upd after update on public.radar_offers for each row execute function public.radar_offer_snapshot();

-- Auditoria (reaproveita audit_row_change ja existente) ---------------------

create trigger audit_radar_sources after insert or update or delete on public.radar_sources for each row execute function public.audit_row_change();
create trigger audit_radar_watchlist after insert or update or delete on public.radar_watchlist for each row execute function public.audit_row_change();
create trigger audit_radar_offers after insert or update or delete on public.radar_offers for each row execute function public.audit_row_change();

-- Oferta manual (unica forma de inserir/atualizar radar_offers) ------------
-- Nenhuma oferta e criada sem url, preco e moeda validos. Nunca inventa dados:
-- os unicos valores gravados sao os informados pelo usuario no payload.

create or replace function public.radar_save_manual_offer(p_payload jsonb)
returns public.radar_offers language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_url text; v_price numeric; v_currency text; v_row public.radar_offers;
begin
  v_org:=nullif(p_payload->>'organization_id','')::uuid;
  if v_org is null or not public.has_org_role(v_org,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  v_url:=btrim(coalesce(p_payload->>'url',''));
  if v_url='' or v_url !~* '^https?://' then raise exception 'url_required'; end if;
  v_price:=nullif(p_payload->>'price_native','')::numeric;
  if v_price is null or v_price<0 then raise exception 'invalid_price'; end if;
  v_currency:=upper(btrim(coalesce(p_payload->>'currency','')));
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;

  insert into public.radar_offers(
    organization_id,perfume_id,watch_item_id,source_id,seller_name,domain,url,
    country_code,country_name,raw_title,price_native,currency,size_ml,concentration,
    availability_status,shipping_to_brazil,shipping_notes,source_type,entry_method,created_by,
    first_seen_at,last_seen_at,last_checked_at
  ) values(
    v_org,
    nullif(p_payload->>'perfume_id','')::uuid,
    nullif(p_payload->>'watch_item_id','')::uuid,
    nullif(p_payload->>'source_id','')::uuid,
    nullif(btrim(p_payload->>'seller_name'),''),
    nullif(lower(btrim(p_payload->>'domain')),''),
    v_url,
    nullif(upper(btrim(p_payload->>'country_code')),''),
    nullif(btrim(p_payload->>'country_name'),''),
    nullif(btrim(p_payload->>'raw_title'),''),
    v_price,v_currency,
    nullif(p_payload->>'size_ml','')::numeric,
    nullif(btrim(p_payload->>'concentration'),''),
    coalesce(nullif(p_payload->>'availability_status',''),'unknown'),
    coalesce(nullif(p_payload->>'shipping_to_brazil',''),'unknown'),
    nullif(btrim(p_payload->>'shipping_notes'),''),
    nullif(btrim(p_payload->>'source_type'),''),
    'manual',auth.uid(),now(),now(),now()
  )
  on conflict(organization_id,url_key) do update set
    seller_name=coalesce(excluded.seller_name,public.radar_offers.seller_name),
    domain=coalesce(excluded.domain,public.radar_offers.domain),
    country_code=coalesce(excluded.country_code,public.radar_offers.country_code),
    country_name=coalesce(excluded.country_name,public.radar_offers.country_name),
    raw_title=coalesce(excluded.raw_title,public.radar_offers.raw_title),
    price_native=excluded.price_native,
    currency=excluded.currency,
    size_ml=coalesce(excluded.size_ml,public.radar_offers.size_ml),
    concentration=coalesce(excluded.concentration,public.radar_offers.concentration),
    availability_status=excluded.availability_status,
    shipping_to_brazil=excluded.shipping_to_brazil,
    shipping_notes=coalesce(excluded.shipping_notes,public.radar_offers.shipping_notes),
    perfume_id=coalesce(excluded.perfume_id,public.radar_offers.perfume_id),
    watch_item_id=coalesce(excluded.watch_item_id,public.radar_offers.watch_item_id),
    source_id=coalesce(excluded.source_id,public.radar_offers.source_id),
    active=true,
    last_seen_at=now(),
    last_checked_at=now()
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.radar_toggle_watch(p_watch_id uuid,p_status text)
returns public.radar_watchlist language plpgsql security definer set search_path=public as $$
declare v public.radar_watchlist;
begin
  select * into v from public.radar_watchlist where id=p_watch_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_status not in('active','paused') then raise exception 'invalid_status'; end if;
  update public.radar_watchlist set status=p_status where id=v.id returning * into v;
  return v;
end $$;

-- Score deterministico (0-100): confiabilidade da fonte + disponibilidade + preco + atualidade.
-- Nunca calculado por IA (spec: score determinístico).

create or replace function public.radar_offer_score(
  p_source_type text,p_trusted boolean,p_availability text,
  p_price numeric,p_group_min numeric,p_group_max numeric,p_checked_at timestamptz
) returns numeric language plpgsql stable as $$
declare v_trust numeric; v_avail numeric; v_price numeric; v_fresh numeric;
begin
  v_trust:=case coalesce(p_source_type,'manual')
    when 'official_brand' then 30 when 'authorized_retailer' then 24 when 'distributor' then 18
    when 'retailer' then 12 when 'marketplace' then 6 else 10 end;
  if coalesce(p_trusted,false) then v_trust:=least(v_trust+4,30); end if;
  v_avail:=case coalesce(p_availability,'unknown')
    when 'in_stock' then 25 when 'low_stock' then 18 when 'preorder' then 10 when 'unknown' then 5 else 0 end;
  if p_group_min is null or p_group_max is null or p_group_max<=p_group_min then
    v_price:=26;
  else
    v_price:=30*(1-((p_price-p_group_min)/(p_group_max-p_group_min)));
  end if;
  v_fresh:=case when p_checked_at is null then 0
    when p_checked_at>now()-interval '24 hours' then 15
    when p_checked_at>now()-interval '72 hours' then 10
    when p_checked_at>now()-interval '168 hours' then 5 else 0 end;
  return round(greatest(0,least(100,v_trust+v_avail+v_price+v_fresh)),0);
end $$;

-- Ofertas de um perfume/item da watchlist, ja com score. Leitura pura (security invoker),
-- respeita RLS do usuario chamador.

create or replace function public.radar_offers_for_perfume(org_id uuid,p_perfume_id uuid default null,p_watch_item_id uuid default null)
returns table(
  id uuid,organization_id uuid,perfume_id uuid,watch_item_id uuid,source_id uuid,
  seller_name text,domain text,url text,country_code text,country_name text,raw_title text,
  price_native numeric,currency text,price_brl numeric,size_ml numeric,concentration text,
  availability_status text,shipping_to_brazil text,shipping_notes text,source_type text,
  confidence_score numeric,first_seen_at timestamptz,last_seen_at timestamptz,last_checked_at timestamptz,
  active boolean,metadata jsonb,entry_method text,source_name text,source_trusted boolean,score numeric
) language sql stable security invoker set search_path=public as $$
  with base as (
    select o.*, s.name as source_name_resolved, s.source_type as source_type_resolved, s.trusted as source_trusted_resolved
    from public.radar_offers o left join public.radar_sources s on s.id=o.source_id
    where o.organization_id=org_id and o.active
      and(org_id in(select public.current_user_org_ids()))
      and(p_perfume_id is null or o.perfume_id=p_perfume_id)
      and(p_watch_item_id is null or o.watch_item_id=p_watch_item_id)
  ),
  grouped as (
    select *,min(price_native) over(partition by currency) as group_min,max(price_native) over(partition by currency) as group_max
    from base
  )
  select g.id,g.organization_id,g.perfume_id,g.watch_item_id,g.source_id,
    g.seller_name,g.domain,g.url,g.country_code,g.country_name,g.raw_title,
    g.price_native,g.currency,g.price_brl,g.size_ml,g.concentration,
    g.availability_status,g.shipping_to_brazil,g.shipping_notes,
    coalesce(g.source_type_resolved,g.source_type) as source_type,
    g.confidence_score,g.first_seen_at,g.last_seen_at,g.last_checked_at,
    g.active,g.metadata,g.entry_method,
    coalesce(g.source_name_resolved,g.seller_name) as source_name,
    coalesce(g.source_trusted_resolved,false) as source_trusted,
    public.radar_offer_score(coalesce(g.source_type_resolved,g.source_type),g.source_trusted_resolved,g.availability_status,g.price_native,g.group_min,g.group_max,g.last_checked_at) as score
  from grouped g;
$$;

-- Agregados autorizados para a camada de IA (item 14/28 do spec). A IA nunca le radar_offers
-- diretamente: so recebe o jsonb determinístico abaixo.

create or replace function public.radar_offer_aggregates(org_id uuid,p_perfume_id uuid default null,p_watch_item_id uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
  with base as (
    select * from public.radar_offers
    where organization_id=org_id and active
      and(org_id in(select public.current_user_org_ids()))
      and(p_perfume_id is null or perfume_id=p_perfume_id)
      and(p_watch_item_id is null or watch_item_id=p_watch_item_id)
  ),
  by_currency as (
    select currency,count(*) as offers,min(price_native) as min_price,max(price_native) as max_price,
      percentile_cont(0.5) within group(order by price_native) as median_price
    from base group by currency
  ),
  by_availability as (
    select availability_status,count(*) as cnt from base group by availability_status
  ),
  by_source_trust as (
    select coalesce(s.source_type,b.source_type,'unknown') as source_type,count(*) as cnt
    from base b left join public.radar_sources s on s.id=b.source_id group by 1
  ),
  drops as (
    select count(distinct o.id) as dropped from public.radar_offers o
    join lateral(
      select price_native from public.radar_offer_snapshots s where s.offer_id=o.id order by checked_at desc offset 1 limit 1
    ) prev on true
    where o.organization_id=org_id and o.active and prev.price_native>o.price_native
      and(p_perfume_id is null or o.perfume_id=p_perfume_id)
      and(p_watch_item_id is null or o.watch_item_id=p_watch_item_id)
  )
  select jsonb_build_object(
    'total_offers',(select count(*) from base),
    'by_availability',(select coalesce(jsonb_object_agg(availability_status,cnt),'{}'::jsonb) from by_availability),
    'by_currency',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'offers',offers,'min_price',min_price,'max_price',max_price,'median_price',median_price)),'[]'::jsonb) from by_currency),
    'sources_by_trust',(select coalesce(jsonb_object_agg(source_type,cnt),'{}'::jsonb) from by_source_trust),
    'price_drops_since_last_check',coalesce((select dropped from drops),0),
    'data_source','Supabase RUAH - ofertas cadastradas manualmente ou por fonte configurada',
    'generated_at',now()
  );
$$;

revoke all on function public.radar_save_manual_offer(jsonb) from public,anon;
revoke all on function public.radar_toggle_watch(uuid,text) from public,anon;
revoke all on function public.radar_offer_score(text,boolean,text,numeric,numeric,numeric,timestamptz) from public,anon;
revoke all on function public.radar_offers_for_perfume(uuid,uuid,uuid) from public,anon;
revoke all on function public.radar_offer_aggregates(uuid,uuid,uuid) from public,anon;
grant execute on function public.radar_save_manual_offer(jsonb) to authenticated,service_role;
grant execute on function public.radar_toggle_watch(uuid,text) to authenticated,service_role;
grant execute on function public.radar_offer_score(text,boolean,text,numeric,numeric,numeric,timestamptz) to authenticated,service_role;
grant execute on function public.radar_offers_for_perfume(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.radar_offer_aggregates(uuid,uuid,uuid) to authenticated,service_role;
