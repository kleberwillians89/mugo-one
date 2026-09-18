begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- fiscal_documents: nfse funcional nesta sprint; nfe/nfce já cabem no
-- CHECK (estrutura pronta, briefing §10), sem UI/emissão real ainda.
-- recipient_snapshot/issuer_snapshot preservam os dados usados NA
-- EMISSÃO — mesmo que Customer/Organization mudem depois (briefing
-- §8). status normalizado, independente de qualquer nome de status
-- específico de provider (briefing §11).
--
-- Idempotência (briefing §19): índice único parcial — só pode existir
-- UM documento não-terminal (fora failed/cancelled) por
-- (organization_id, sale_id, document_type). Clicar 3x, ou reprocessar
-- o mesmo pedido, encontra o já existente em vez de duplicar; depois
-- de failed/cancelled, um novo pedido pode abrir outro.
-- ============================================================

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  sale_id uuid references public.sales(id) on delete set null,
  -- Sem entidade payment separada nesta sprint (ver
  -- docs/FISCAL_MIGRATION_PLAN.md §1) — payment_id fica preparado,
  -- sempre nulo por enquanto.
  payment_id uuid,

  document_type text not null check (document_type in ('nfse', 'nfe', 'nfce')),

  provider text not null check (btrim(provider) <> ''),
  provider_document_id text,

  environment text not null check (environment in ('sandbox', 'production')),
  status text not null default 'draft' check (status in ('draft', 'requested', 'processing', 'authorized', 'rejected', 'cancelled', 'failed')),

  number text,
  series text,
  access_key text,

  issued_at timestamptz,
  authorized_at timestamptz,
  cancelled_at timestamptz,

  total_amount numeric(14,2) not null check (total_amount >= 0),

  recipient_snapshot jsonb not null,
  issuer_snapshot jsonb not null,

  provider_status text,
  provider_response_metadata jsonb not null default '{}'::jsonb,

  error_code text,
  error_message text,

  idempotency_key text,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index fiscal_documents_open_request_idx
  on public.fiscal_documents(organization_id, sale_id, document_type)
  where status not in ('failed', 'cancelled') and sale_id is not null;

create index fiscal_documents_org_status_idx on public.fiscal_documents(organization_id, status, created_at desc);
create index fiscal_documents_org_sale_idx on public.fiscal_documents(organization_id, sale_id) where sale_id is not null;
create index fiscal_documents_provider_doc_idx on public.fiscal_documents(provider, provider_document_id) where provider_document_id is not null;

create or replace function public.fiscal_documents_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fiscal_documents_set_updated_at
before update on public.fiscal_documents
for each row execute function public.fiscal_documents_set_updated_at();

create trigger fiscal_documents_prevent_organization_change
before update of organization_id on public.fiscal_documents
for each row execute function public.crm_prevent_organization_change();

-- Documento autorizado é imutável (briefing §46): nenhuma coluna de
-- conteúdo pode mudar depois de authorized — só campos operacionais
-- (cancelled_at/status quando vira 'cancelled' por uma ação explícita
-- de cancelamento, provider_response_metadata/provider_status para
-- registrar uma consulta de status).
create or replace function public.fiscal_documents_prevent_authorized_edit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'authorized' and new.status not in ('authorized', 'cancelled') then
    raise exception 'fiscal_document_authorized_immutable';
  end if;
  if old.status = 'authorized' and (
    new.total_amount is distinct from old.total_amount
    or new.recipient_snapshot is distinct from old.recipient_snapshot
    or new.issuer_snapshot is distinct from old.issuer_snapshot
    or new.number is distinct from old.number
    or new.access_key is distinct from old.access_key
  ) then
    raise exception 'fiscal_document_authorized_immutable';
  end if;
  return new;
end;
$$;

create trigger fiscal_documents_prevent_authorized_edit
before update on public.fiscal_documents
for each row execute function public.fiscal_documents_prevent_authorized_edit();

alter table public.fiscal_documents enable row level security;

create policy fiscal_documents_org_select on public.fiscal_documents for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'fiscal.view')
);

grant select on public.fiscal_documents to authenticated;
-- Escrita só via RPC SECURITY DEFINER (request_fiscal_document /
-- update_fiscal_document_status / cancel_fiscal_document) — mesmo
-- padrão de lead_intake_events/messages/domain_events.

create table public.fiscal_document_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete cascade,

  sale_item_id uuid references public.sale_items(id) on delete set null,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,

  description text not null check (btrim(description) <> ''),
  quantity numeric not null check (quantity > 0),
  unit text not null default 'un',
  unit_price numeric not null check (unit_price >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),

  -- Livre/config-driven (código de serviço, classificação tributária
  -- etc.) — nunca hardcoded no Core (briefing §13).
  fiscal_data jsonb not null default '{}'::jsonb,

  position integer not null default 0,

  created_at timestamptz not null default now()
);

create index fiscal_document_items_document_idx on public.fiscal_document_items(fiscal_document_id, position);

alter table public.fiscal_document_items enable row level security;

create policy fiscal_document_items_org_select on public.fiscal_document_items for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'fiscal.view')
);

grant select on public.fiscal_document_items to authenticated;

commit;
