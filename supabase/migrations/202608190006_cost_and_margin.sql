begin;

-- RUAH — Roadmap operacional, FASE 8: custo e margem.
--
-- "Quanto custa? Qual margem gera?" — hoje nenhum custo de aquisição existe
-- em lugar nenhum do schema: perfumes/inventory_items/inventory_bottles são
-- só metadado e quantidade; radar_offers.price_native é o preço de uma
-- OFERTA EXTERNA encontrada pelo radar ("quanto custaria se comprar ali"),
-- não "quanto pagamos pelo que já está no estoque" — ligar as duas pontas
-- é trabalho da Fase 9 (Radar Buying Intelligence), não desta fase.
--
-- Extensão mínima: um único custo médio por ml, por perfume, mantido pela
-- gestão — não um livro-razão de custo por lote/reposição (esse
-- refinamento fica para quando/se for realmente necessário; nada na
-- operação hoje precisa de custo histórico por compra, só do "quanto
-- custa" atual). Nullable de propósito: "custo não informado" é um estado
-- real e honesto — margem não pode fingir ser calculável para o que a
-- gestão ainda não custeou (ver has_cost em perfume_margin_summary abaixo).
alter table public.perfumes add column average_cost_per_ml numeric(14,2);

create or replace function public.perfume_set_cost(p_perfume_id uuid,p_cost_per_ml numeric)
returns public.perfumes
language plpgsql security definer set search_path=public
as $$
declare v_org uuid; v_row public.perfumes;
begin
  select organization_id into v_org from public.perfumes where id=p_perfume_id;
  if v_org is null or v_org not in(select public.current_user_org_ids()) then raise exception 'perfume_not_found'; end if;
  if not public.has_org_role(v_org,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_cost_per_ml is not null and p_cost_per_ml<0 then raise exception 'invalid_cost'; end if;

  update public.perfumes set average_cost_per_ml=p_cost_per_ml where id=p_perfume_id returning * into v_row;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_org,auth.uid(),'perfume_cost_set','perfume',p_perfume_id::text,jsonb_build_object('cost_per_ml',p_cost_per_ml));
  return v_row;
end;
$$;
grant execute on function public.perfume_set_cost(uuid,numeric) to authenticated,service_role;

-- "true replace" (definição vigente: 202608140002_ai_inventory_bootstrap.sql)
-- — mesma consulta operacional do Estoque, só acrescentando o custo atual
-- (quando informado) ao final da lista de colunas; nada mais muda, então
-- todo consumidor existente (Estoque, seletor de nova venda, importação IA,
-- inventory_summary via subquery) continua recebendo exatamente as mesmas
-- colunas que já lia, na mesma ordem.
create or replace function public.inventory_operational_rows(org_id uuid)
returns table(item_id uuid,perfume_id uuid,perfume text,physical_ml numeric,reserved_ml numeric,
  shipping_ml numeric,available_ml numeric,minimum_ml numeric,reconciliation_status text,
  average_cost_per_ml numeric)
language sql stable security invoker set search_path=public as $$
  select i.id,p.id,p.full_name_raw,i.physical_ml,
    coalesce(sum(a.quantity_ml) filter(where a.status='reserved'),0),
    coalesce(sum(a.quantity_ml) filter(where a.status='shipping'),0),
    case when i.bootstrap_pending_verification then 0 else i.available_ml end,
    i.minimum_ml,i.reconciliation_status,p.average_cost_per_ml
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_allocations a on a.inventory_item_id=i.id
  where i.organization_id=org_id and i.status='active'
  group by i.id,p.id,p.full_name_raw,p.average_cost_per_ml order by p.full_name_raw;
$$;

-- Leitura por período: uma linha por perfume vendido na janela, receita
-- real (sales.amount) contra custo estimado (average_cost_per_ml *
-- ml vendido). known_cost/margin/margin_pct saem NULL por propagação
-- aritmética normal quando o custo não foi informado — o front decide como
-- exibir "sem custo informado" a partir de has_cost, nunca inventa um
-- número.
create or replace function public.perfume_margin_summary(org_id uuid,start_date date,end_date date)
returns table(
  perfume_id uuid,perfume_name text,units_sold bigint,total_ml numeric,revenue numeric,
  average_cost_per_ml numeric,known_cost numeric,margin numeric,margin_pct numeric,has_cost boolean
) language sql stable security invoker set search_path=public
as $$
  with base as (
    select p.id as perfume_id,p.full_name_raw as perfume_name,p.average_cost_per_ml,
      count(s.id) as units_sold,coalesce(sum(s.volume_ml),0) as total_ml,coalesce(sum(s.amount),0) as revenue
    from public.sales s join public.perfumes p on p.id=s.perfume_id
    where s.organization_id=org_id and s.deleted_at is null and s.payment_status<>'cancelled'
      and s.sale_date between start_date and end_date
    group by p.id,p.full_name_raw,p.average_cost_per_ml
  )
  select base.perfume_id,base.perfume_name,base.units_sold,base.total_ml,base.revenue,
    base.average_cost_per_ml,
    base.average_cost_per_ml*base.total_ml as known_cost,
    base.revenue-(base.average_cost_per_ml*base.total_ml) as margin,
    case when base.revenue>0 then round(((base.revenue-(base.average_cost_per_ml*base.total_ml))/base.revenue)*100,1) end as margin_pct,
    base.average_cost_per_ml is not null as has_cost
  from base
  order by base.revenue desc;
$$;
grant execute on function public.perfume_margin_summary(uuid,date,date) to authenticated,service_role;

commit;
