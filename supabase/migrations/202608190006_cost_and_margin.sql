begin;

-- RUAH — Roadmap operacional, FASE 8: custo e margem.
--
-- "Quanto custa? Qual margem gera?"
--
-- Hoje nenhum custo de aquisição existe de forma operacional no schema.
-- radar_offers.price_native representa uma OFERTA EXTERNA encontrada pelo
-- Radar ("quanto custaria comprar ali"), não necessariamente quanto a RUAH
-- pagou pelo estoque atual.
--
-- Nesta fase, usamos um custo médio por ml por perfume.
-- Nullable propositalmente:
-- custo não informado é um estado real e margem não pode virar um número
-- inventado quando não existe base de custo.

alter table public.perfumes
  add column average_cost_per_ml numeric(14,2);


-- ============================================================
-- DEFINIÇÃO / ALTERAÇÃO DO CUSTO MÉDIO DO PERFUME
-- ============================================================

create or replace function public.perfume_set_cost(
  p_perfume_id uuid,
  p_cost_per_ml numeric
)
returns public.perfumes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.perfumes;
begin
  select organization_id
    into v_org
  from public.perfumes
  where id = p_perfume_id;

  if v_org is null
     or v_org not in (
       select public.current_user_org_ids()
     ) then
    raise exception 'perfume_not_found';
  end if;

  if not public.has_org_role(
    v_org,
    array['admin','manager']::public.member_role[]
  ) then
    raise exception 'forbidden';
  end if;

  if p_cost_per_ml is not null
     and p_cost_per_ml < 0 then
    raise exception 'invalid_cost';
  end if;

  update public.perfumes
  set average_cost_per_ml = p_cost_per_ml
  where id = p_perfume_id
  returning *
    into v_row;

  insert into public.audit_logs(
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values(
    v_org,
    auth.uid(),
    'perfume_cost_set',
    'perfume',
    p_perfume_id::text,
    jsonb_build_object(
      'cost_per_ml',
      p_cost_per_ml
    )
  );

  return v_row;
end;
$$;

grant execute
  on function public.perfume_set_cost(uuid, numeric)
  to authenticated, service_role;


-- ============================================================
-- ESTOQUE OPERACIONAL + CUSTO
-- ============================================================
--
-- A função inventory_operational_rows(uuid) já existe no remoto,
-- criada em migration anterior, com um RETURNS TABLE menor.
--
-- PostgreSQL não permite alterar o row type de RETURNS TABLE por meio
-- de CREATE OR REPLACE.
--
-- Como esta migration 202608190006 ainda NÃO foi aplicada remotamente,
-- removemos a assinatura antiga e a recriamos imediatamente dentro da
-- mesma transação com a nova coluna average_cost_per_ml.
--
-- NÃO usar CASCADE.

drop function if exists public.inventory_operational_rows(uuid);

create function public.inventory_operational_rows(
  org_id uuid
)
returns table(
  item_id uuid,
  perfume_id uuid,
  perfume text,
  physical_ml numeric,
  reserved_ml numeric,
  shipping_ml numeric,
  available_ml numeric,
  minimum_ml numeric,
  reconciliation_status text,
  average_cost_per_ml numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id as item_id,
    p.id as perfume_id,
    p.full_name_raw as perfume,
    i.physical_ml,

    coalesce(
      sum(a.quantity_ml) filter (
        where a.status = 'reserved'
      ),
      0
    ) as reserved_ml,

    coalesce(
      sum(a.quantity_ml) filter (
        where a.status = 'shipping'
      ),
      0
    ) as shipping_ml,

    case
      when i.bootstrap_pending_verification
        then 0
      else i.available_ml
    end as available_ml,

    i.minimum_ml,
    i.reconciliation_status,
    p.average_cost_per_ml

  from public.inventory_items i

  join public.perfumes p
    on p.id = i.perfume_id

  left join public.inventory_allocations a
    on a.inventory_item_id = i.id

  where i.organization_id = org_id
    and i.status = 'active'

  group by
    i.id,
    p.id,
    p.full_name_raw,
    p.average_cost_per_ml

  order by
    p.full_name_raw;
$$;

-- DROP remove os privilégios da função antiga.
-- Reaplicamos explicitamente para o CRM continuar podendo chamar o RPC.

grant execute
  on function public.inventory_operational_rows(uuid)
  to authenticated, service_role;


-- ============================================================
-- RESUMO DE CUSTO E MARGEM POR PERFUME
-- ============================================================
--
-- Uma linha por perfume vendido no período.
--
-- Receita:
-- sales.amount
--
-- Custo estimado:
-- average_cost_per_ml * ml vendido
--
-- Quando average_cost_per_ml for NULL:
-- known_cost = NULL
-- margin = NULL
-- margin_pct = NULL
-- has_cost = false
--
-- Nunca transformar custo desconhecido em zero.

create or replace function public.perfume_margin_summary(
  org_id uuid,
  start_date date,
  end_date date
)
returns table(
  perfume_id uuid,
  perfume_name text,
  units_sold bigint,
  total_ml numeric,
  revenue numeric,
  average_cost_per_ml numeric,
  known_cost numeric,
  margin numeric,
  margin_pct numeric,
  has_cost boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      p.id as perfume_id,
      p.full_name_raw as perfume_name,
      p.average_cost_per_ml,

      count(s.id) as units_sold,

      coalesce(
        sum(s.volume_ml),
        0
      ) as total_ml,

      coalesce(
        sum(s.amount),
        0
      ) as revenue

    from public.sales s

    join public.perfumes p
      on p.id = s.perfume_id

    where s.organization_id = org_id
      and s.deleted_at is null
      and s.payment_status <> 'cancelled'
      and s.sale_date between start_date and end_date

    group by
      p.id,
      p.full_name_raw,
      p.average_cost_per_ml
  )

  select
    base.perfume_id,
    base.perfume_name,
    base.units_sold,
    base.total_ml,
    base.revenue,
    base.average_cost_per_ml,

    base.average_cost_per_ml * base.total_ml
      as known_cost,

    base.revenue
      - (base.average_cost_per_ml * base.total_ml)
      as margin,

    case
      when base.revenue > 0 then
        round(
          (
            (
              base.revenue
              - (base.average_cost_per_ml * base.total_ml)
            )
            / base.revenue
          ) * 100,
          1
        )
    end as margin_pct,

    base.average_cost_per_ml is not null
      as has_cost

  from base

  order by
    base.revenue desc;
$$;

grant execute
  on function public.perfume_margin_summary(uuid, date, date)
  to authenticated, service_role;


commit;