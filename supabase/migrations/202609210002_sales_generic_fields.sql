begin;

-- ============================================================
-- MUGÔ ONE — Sprint "Catálogo Universal + Sale Items" (Fase E)
--
-- Campos genéricos aditivos em `sales`. Nenhuma coluna legada é
-- alterada ou removida (ver docs/SALES_CATALOG_MIGRATION_PLAN.md §1) —
-- `perfume_id`/`volume_ml`/`bottle_identifier`/`sale_type`/
-- `split_completed_at` continuam existindo e sendo lidas pelo legado
-- (Davi Excel isolado, RPCs davi_excel_*).
--
-- `status` é deliberadamente separado de `payment_status`: hoje
-- `payment_status` já cobre paid/pending/cancelled/unknown, mas
-- `status` (open/completed/cancelled) descreve o ciclo de vida da
-- VENDA em si, não do pagamento — uma venda pode estar 'completed'
-- com pagamento 'pending' (serviço já entregue, cobrança em aberto).
-- ============================================================

alter table public.sales
  add column if not exists status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  add column if not exists subtotal numeric(14,2),
  add column if not exists discount_total numeric(14,2) not null default 0
    check (discount_total >= 0),
  add column if not exists total_amount numeric(14,2),
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source_channel text,
  add column if not exists source_medium text,
  add column if not exists source_campaign text,
  add column if not exists source_external_id text,
  add column if not exists attribution_metadata jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists sales_org_owner_idx
  on public.sales(organization_id, owner_user_id)
  where owner_user_id is not null;
create index if not exists sales_org_status_idx
  on public.sales(organization_id, status);

-- Backfill não destrutivo: para vendas já existentes, `total_amount`
-- reflete o `amount` já gravado (nunca inventa um valor novo);
-- `subtotal` fica igual por não termos desconto histórico registrado.
-- Vendas novas (Fase F) sempre gravam os três via
-- create_sale_with_items, calculado no servidor.
update public.sales
set subtotal = coalesce(subtotal, amount),
    total_amount = coalesce(total_amount, amount)
where subtotal is null or total_amount is null;

commit;
