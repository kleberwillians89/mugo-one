begin;

-- RUAH — Roadmap operacional, FASE 7: recuperação de clientes.
--
-- "Quem está deixando de comprar?" — client_period_summary já calcula um
-- relationship_status parecido, mas é limitado À JANELA do período
-- selecionado na tela de Clientes: um cliente sem nenhuma venda dentro do
-- período informado simplesmente não aparece no agregado (LEFT JOIN sem
-- match), e cai no ramo ELSE do CASE = 'active' por padrão — o oposto do
-- que se quer aqui. Recuperação precisa ser LIFETIME, independente do
-- filtro de período da tela de Clientes, para nunca "esconder" quem
-- realmente parou de comprar. Reaproveita a mesma linguagem de limiar
-- (inativo = 90 dias, igual client_period_summary) mas medida contra a
-- última compra HISTÓRICA de fato, e só considera quem já teve uma relação
-- real (>=2 compras não canceladas) — não quem nunca comprou.
--
-- Zero tabela nova: task_assignments (Fase 5) já foi criada com
-- 'customer_recovery' no check constraint de entity_type, então
-- task_assign/task_resolve já cobrem "quem está cuidando desta
-- recuperação" sem qualquer alteração de schema.
create or replace function public.client_recovery_queue(org_id uuid)
returns table(
  client_id uuid,client_name text,phone text,whatsapp_phone text,
  purchase_count bigint,total_purchased numeric,last_purchase date,days_since_last_purchase integer,
  assignment_id uuid,assigned_to_name text
) language sql stable security invoker set search_path=public
as $$
  with stats as (
    select
      c.id as client_id,c.name as client_name,c.phone,c.whatsapp_phone,
      count(s.id) filter(where s.payment_status<>'cancelled') as purchase_count,
      coalesce(sum(s.amount) filter(where s.payment_status<>'cancelled'),0) as total_purchased,
      max(s.sale_date) filter(where s.payment_status<>'cancelled') as last_purchase
    from public.clients c
    left join public.sales s on s.client_id=c.id and s.organization_id=org_id and s.deleted_at is null
    where c.organization_id=org_id and c.deleted_at is null
    group by c.id,c.name,c.phone,c.whatsapp_phone
  )
  select stats.client_id,stats.client_name,stats.phone,stats.whatsapp_phone,
    stats.purchase_count,stats.total_purchased,stats.last_purchase,
    ((now() at time zone 'America/Sao_Paulo')::date-stats.last_purchase)::integer,
    ta.id,ta.assigned_to_name_snapshot
  from stats
  left join public.task_assignments ta
    on ta.organization_id=org_id and ta.entity_type='customer_recovery' and ta.entity_id=stats.client_id and ta.resolved_at is null
  where stats.purchase_count>=2
    and stats.last_purchase<(now() at time zone 'America/Sao_Paulo')::date-90
  order by stats.total_purchased desc,stats.last_purchase;
$$;
grant execute on function public.client_recovery_queue(uuid) to authenticated,service_role;

commit;
