begin;

-- ============================================================
-- MUGÔ ONE — Sprint Final de Produto (Cobranças Simples + Zero Ruah + UX Apple)
--
-- ask-intelligence/radar-summary consomem estes agregados diretamente
-- (data_source aparece no JSON devolvido pela RPC, que alimenta o
-- prompt/exibição da IA). "IA" não tem feature gate de página
-- (Intelligence.tsx só exige ai_import.view) — é runtime ativo para
-- qualquer organização hoje, não legado desligado. Só o rótulo muda;
-- nenhuma lógica de agregação é alterada.
-- ============================================================

create or replace function public.ai_authorized_aggregates(org_id uuid, start_date date, end_date date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
select public.commercial_period_summary(org_id,start_date,end_date)-'daily'||jsonb_build_object('logistics',public.logistics_operational_summary(org_id,start_date,end_date),'data_source','Mugô One - agregados autorizados','generated_at',now(),'timezone','America/Sao_Paulo');
$function$;

create or replace function public.radar_offer_aggregates(org_id uuid, p_perfume_id uuid DEFAULT NULL::uuid, p_watch_item_id uuid DEFAULT NULL::uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
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
    'data_source','Mugô One - ofertas cadastradas manualmente ou por fonte configurada',
    'generated_at',now()
  );
$function$;

commit;
