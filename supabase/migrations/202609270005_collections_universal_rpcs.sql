begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- Bug ativo raiz (ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md):
-- collections_pending_sales_canonical/_operational/_pending devolviam
-- perfume_name/perfume_brand/sale_type/volume_ml (join direto com
-- public.perfumes) — Cobrança nunca deveria depender do vertical de
-- perfumaria. Reescritas para devolver só colunas universais; o
-- resumo do item (hoje "perfume + tipo + ml") passa a vir do MESMO
-- mecanismo já usado em Vendas/Planilha
-- (fetchSaleItemsSummaries/itemsSummaryLabel, src/lib/sale-items.ts) —
-- buscado à parte no frontend, não duplicado aqui em SQL.
--
-- RETURNS TABLE muda de shape — CREATE OR REPLACE não permite isso
-- (Postgres recusa mudar o tipo de retorno), por isso o DROP explícito
-- antes de recriar (mesma disciplina de 202609250010_drop_stale_overloads.sql).
--
-- Novas colunas universais: due_date (sale_date + default_due_days da
-- organização, nunca inventado — não existe vencimento financeiro
-- persistido em sales, só o prazo operacional de envio, que é outro
-- conceito), owner_user_id/owner_name (responsável, briefing §16-17),
-- last_attempt_at/last_attempt_channel/last_attempt_status (do novo
-- collection_attempts, Communication Hub) ao lado do
-- last_message_copied_at/message_copied_count já existente (do
-- collection_events antigo, "copiar mensagem" manual) — as duas
-- trilhas de histórico continuam existindo lado a lado, cada uma
-- descrevendo o que realmente aconteceu.
--
-- whatsapp_customer_balance_v1 (consumidor real confirmado do
-- _operational) só usa client_id/amount — inalterado por este DROP.
-- ============================================================

drop function if exists public.collections_pending_sales(text);
drop function if exists public.collections_pending_sales_operational(uuid);
drop function if exists public.collections_pending_sales_canonical(uuid);

create or replace function public.collections_pending_sales_canonical(p_organization_id uuid)
returns table(
  id uuid, client_id uuid, client_number integer, client_name text, sale_date date, due_date date,
  amount numeric, payment_status text, owner_user_id uuid, owner_name text,
  last_message_copied_at timestamptz, message_copied_count integer,
  last_attempt_at timestamptz, last_attempt_channel text, last_attempt_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.client_id, c.client_number, c.name, s.sale_date,
    s.sale_date + coalesce(ocs.default_due_days, 7),
    s.amount, s.payment_status::text, s.owner_user_id, nullif(btrim(p.full_name), ''),
    ce.last_at, coalesce(ce.total, 0)::integer,
    ca.last_attempt_at, ca.last_attempt_channel, ca.last_attempt_status
  from public.sales s
  join public.clients c on c.id = s.client_id and c.organization_id = s.organization_id
  left join public.profiles p on p.id = s.owner_user_id
  left join public.organization_collection_settings ocs on ocs.organization_id = s.organization_id
  left join lateral (
    select max(e.created_at) last_at, count(*) total
    from public.collection_events e
    where e.client_id = s.client_id and e.organization_id = s.organization_id and e.event_type = 'message_copied'
  ) ce on true
  left join lateral (
    select a.created_at last_attempt_at, a.channel last_attempt_channel, a.status last_attempt_status
    from public.collection_attempts a
    where a.client_id = s.client_id and a.organization_id = s.organization_id
    order by a.created_at desc
    limit 1
  ) ca on true
  where s.organization_id = p_organization_id
    and s.deleted_at is null
    and s.payment_status = 'pending';
$$;

create or replace function public.collections_pending_sales_operational(p_organization_id uuid)
returns table(
  id uuid, client_id uuid, client_number integer, client_name text, sale_date date, due_date date,
  amount numeric, payment_status text, owner_user_id uuid, owner_name text,
  last_message_copied_at timestamptz, message_copied_count integer,
  last_attempt_at timestamptz, last_attempt_channel text, last_attempt_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select pending.*
  from public.collections_pending_sales_canonical(p_organization_id) pending
  where pending.sale_date >= public.operational_sales_floor(p_organization_id);
$$;

create or replace function public.collections_pending_sales(p_search text default null)
returns table(
  id uuid, client_id uuid, client_number integer, client_name text, sale_date date, due_date date,
  amount numeric, payment_status text, owner_user_id uuid, owner_name text,
  last_message_copied_at timestamptz, message_copied_count integer,
  last_attempt_at timestamptz, last_attempt_channel text, last_attempt_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select pending.*
  from public.current_user_org_ids() as organizations(organization_id)
  cross join lateral public.collections_pending_sales_operational(organizations.organization_id) pending
  where public.has_org_permission(organizations.organization_id, 'sales.view')
    and (
      coalesce(btrim(p_search), '') = ''
      or pending.client_name ilike '%' || btrim(p_search) || '%'
      or pending.client_number::text ilike '%' || btrim(p_search) || '%'
    )
  order by pending.sale_date asc, pending.id asc;
$$;

grant execute on function public.collections_pending_sales_canonical(uuid) to service_role;
grant execute on function public.collections_pending_sales_operational(uuid) to service_role;
grant execute on function public.collections_pending_sales(text) to authenticated;

commit;
