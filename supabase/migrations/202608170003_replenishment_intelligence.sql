-- RUAH — Inteligencia de Reposicao (Estoque -> Alerta -> Radar).
-- Aditiva apenas. Nao altera inventory_items, sales, radar_* ou qualquer regra existente.
--
-- Principio: este RPC calcula SOMENTE sinais deterministicos a partir de dados reais
-- (estoque operacional + vendas). Nenhuma IA decide estoque/velocidade/demanda aqui — a
-- camada de IA (edge function replenishment-summary) so recebe estes numeros ja prontos e
-- os traduz para portugues, nunca recalcula ou inventa.

create or replace function public.replenishment_signals(org_id uuid)
returns table(
  item_id uuid, perfume_id uuid, perfume text, brand_house text, base_name text, bottle_identifier text,
  available_ml numeric, minimum_ml numeric, physical_ml numeric, reconciliation_status text,
  ml_7d numeric, ml_30d numeric, ml_60d numeric, ml_90d numeric,
  sales_count_7d integer, sales_count_30d integer, sales_count_90d integer,
  last_sale_at date,
  velocity_ml_per_day numeric, coverage_days numeric,
  status text, priority_score numeric
) language sql stable security invoker set search_path=public as $$
  with base_items as (
    -- Mesma mascara de inventory_operational_rows: item com bootstrap pendente de
    -- verificacao humana NUNCA conta como estoque disponivel para calculo de sinais.
    select i.id as item_id, p.id as perfume_id, p.full_name_raw as perfume, p.brand_house,
      p.base_name, p.bottle_identifier,
      case when i.bootstrap_pending_verification then 0 else i.available_ml end as available_ml,
      i.minimum_ml, i.physical_ml, i.reconciliation_status
    from public.inventory_items i
    join public.perfumes p on p.id = i.perfume_id
    where i.organization_id = org_id and i.status = 'active'
      and org_id in (select public.current_user_org_ids())
  ),
  sales_windows as (
    select perfume_id,
      coalesce(sum(volume_ml) filter(where sale_date >= current_date - 7), 0) as ml_7d,
      coalesce(sum(volume_ml) filter(where sale_date >= current_date - 30), 0) as ml_30d,
      coalesce(sum(volume_ml) filter(where sale_date >= current_date - 60), 0) as ml_60d,
      coalesce(sum(volume_ml) filter(where sale_date >= current_date - 90), 0) as ml_90d,
      count(*) filter(where sale_date >= current_date - 7) as sales_count_7d,
      count(*) filter(where sale_date >= current_date - 30) as sales_count_30d,
      count(*) filter(where sale_date >= current_date - 90) as sales_count_90d,
      max(sale_date) as last_sale_at
    from public.sales
    where organization_id = org_id and deleted_at is null and payment_status <> 'cancelled'
      and perfume_id is not null and sale_date >= current_date - 90
    group by perfume_id
  ),
  joined as (
    select bi.*, sw.ml_7d, sw.ml_30d, sw.ml_60d, sw.ml_90d,
      sw.sales_count_7d, sw.sales_count_30d, sw.sales_count_90d, sw.last_sale_at
    from base_items bi left join sales_windows sw on sw.perfume_id = bi.perfume_id
  ),
  velocity as (
    -- So calcula velocidade com volume de dados minimo (>=2 vendas na janela). Sem isso,
    -- fica null — "Histórico insuficiente" no lugar de uma media inventada com 1 amostra.
    select *,
      case
        when coalesce(sales_count_30d,0) >= 2 then round(coalesce(ml_30d,0)/30.0, 3)
        when coalesce(sales_count_90d,0) >= 2 then round(coalesce(ml_90d,0)/90.0, 3)
        else null
      end as velocity_ml_per_day
    from joined
  ),
  coverage as (
    select *,
      case when velocity_ml_per_day is not null and velocity_ml_per_day > 0
        then round(available_ml / velocity_ml_per_day, 1) else null end as coverage_days
    from velocity
  ),
  classified as (
    select *,
      -- Ordem importa (primeira condicao verdadeira vence). Combina estoque + velocidade +
      -- recencia para evitar falso alerta (item 5 do spec): estoque baixo sozinho, sem venda
      -- recente, nunca vira CRITICO/REPOR — cai em ATENCAO/SAUDAVEL/SEM_DADOS.
      case
        -- nunca vendeu: sem dado de demanda, nunca "urgente" so por estar sem estoque.
        when last_sale_at is null then 'sem_dados'
        -- esgotado e vendendo ate recentemente (30d) = urgencia real.
        when available_ml <= 0 and last_sale_at >= current_date - 30 then 'critico'
        -- velocidade confirmada e cobertura curta (<=30 dias de estoque no ritmo atual).
        when velocity_ml_per_day is not null and coverage_days is not null and coverage_days <= 30 then 'repor'
        -- abaixo do minimo configurado, mesmo sem velocidade confiavel para prever cobertura.
        when minimum_ml > 0 and available_ml < minimum_ml then 'atencao'
        -- cobertura moderada (30-60 dias).
        when velocity_ml_per_day is not null and coverage_days is not null and coverage_days <= 60 then 'atencao'
        else 'saudavel'
      end as status
    from coverage
  )
  select item_id, perfume_id, perfume, brand_house, base_name, bottle_identifier,
    available_ml, minimum_ml, physical_ml, reconciliation_status,
    ml_7d, ml_30d, ml_60d, ml_90d,
    sales_count_7d::integer, sales_count_30d::integer, sales_count_90d::integer, last_sale_at,
    velocity_ml_per_day, coverage_days, status,
    -- Score so para ordenar internamente — nunca exibido ao usuario final (item 6 do spec).
    round(
      (case status
        when 'critico' then 100 when 'repor' then 70 when 'atencao' then 40
        when 'saudavel' then 10 else 0 end)::numeric
      - coalesce(coverage_days,999)*0.3
      + greatest(0, minimum_ml - available_ml)*0.1
    , 1) as priority_score
  from classified
  order by priority_score desc, perfume asc;
$$;

revoke all on function public.replenishment_signals(uuid) from public,anon;
grant execute on function public.replenishment_signals(uuid) to authenticated,service_role;
