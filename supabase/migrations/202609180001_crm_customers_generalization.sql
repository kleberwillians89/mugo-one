-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- Generalização de clients → CUSTOMER
--
-- Só colunas aditivas em `clients` (nenhuma coluna, trigger, policy ou
-- RPC existente é alterada). `clients` continua sendo a tabela física
-- — "customers" é um conceito de domínio novo, mapeado no frontend
-- (src/modules/crm/customers/). Ver docs/CRM_DOMAIN_MODEL.md.
-- ============================================================

alter table public.clients
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists country text not null default 'BR',
  add column if not exists source_channel text,
  add column if not exists source_campaign text,
  add column if not exists source_medium text,
  add column if not exists source_external_id text,
  add column if not exists attribution_metadata jsonb not null default '{}'::jsonb;

-- `source` (text, default 'manual') já existe desde
-- 202607290003_data_preservation_and_reconciliation.sql e não foi
-- tocado — os campos acima são um detalhamento adicional dele, não uma
-- substituição.

create index if not exists clients_org_owner_idx
  on public.clients(organization_id, owner_user_id)
  where owner_user_id is not null;
