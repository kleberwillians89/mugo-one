begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- lead_intake_events: registro IMUTÁVEL de cada evento bruto/normalizado
-- vindo de fora (site, form, webhook, API, ManyChat, import futuro).
-- Diferente de touchpoint (interação atribuída a uma identidade JÁ
-- resolvida) — este é o evento de ENTRADA em si, antes/durante a
-- resolução de identidade. Ver docs/LEAD_INTAKE_MIGRATION_PLAN.md.
--
-- provider ≠ channel: channel é o canal (website/meta_ads/whatsapp/...,
-- não é enum rígido — texto livre documentado), provider é quem
-- entregou o dado (generic_webhook/meta/google/manychat/...).
--
-- click_id/click_id_type: modelo genérico (não uma coluna por
-- plataforma) para gclid/gbraid/wbraid/fbclid — extensível sem migration
-- nova quando outra plataforma aparecer.
-- ============================================================

create table public.lead_intake_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid references public.lead_intake_endpoints(id) on delete set null,

  provider text not null check (btrim(provider) <> ''),
  channel text not null check (btrim(channel) <> ''),
  external_id text,
  idempotency_key text,

  name text,
  email text,
  phone text,
  document text,
  company_name text,

  interest_catalog_item_id uuid references public.catalog_items(id) on delete set null,
  interest_text text,

  source text,
  medium text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  form_id text,
  form_name text,
  landing_page text,
  referrer text,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  click_id text,
  click_id_type text,

  -- Normalizadas na escrita (mesmo padrão de clients.normalized_*) —
  -- decisão de não criar entity_identities, ver docs §4.
  normalized_email text,
  normalized_phone text,
  normalized_document text,

  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),

  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'duplicate', 'identity_conflict', 'invalid', 'failed')),
  error_code text,

  resolved_customer_id uuid references public.clients(id) on delete set null,
  resolved_company_id uuid references public.companies(id) on delete set null,
  resolved_contact_id uuid references public.contacts(id) on delete set null,
  resolved_lead_id uuid references public.leads(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,
  -- Sanitizado ANTES de chegar aqui (nunca Authorization/token/secret/
  -- cookie/service_role) — a limpeza acontece em lead_intake_submit(),
  -- nunca confiar em quem chama para já ter sanitizado.
  raw_payload jsonb,

  created_at timestamptz not null default now()
);

-- Idempotência: mesmo provider+external_id, ou mesma idempotency_key,
-- nunca cria um segundo evento "efetivo" — ver lead_intake_submit().
create unique index lead_intake_events_org_provider_external_idx
  on public.lead_intake_events(organization_id, provider, external_id)
  where external_id is not null;
create unique index lead_intake_events_org_idempotency_idx
  on public.lead_intake_events(organization_id, idempotency_key)
  where idempotency_key is not null;

create index lead_intake_events_org_status_idx
  on public.lead_intake_events(organization_id, processing_status, created_at desc);
create index lead_intake_events_org_email_idx
  on public.lead_intake_events(organization_id, normalized_email) where normalized_email is not null;
create index lead_intake_events_org_phone_idx
  on public.lead_intake_events(organization_id, normalized_phone) where normalized_phone is not null;
create index lead_intake_events_org_document_idx
  on public.lead_intake_events(organization_id, normalized_document) where normalized_document is not null;
create index lead_intake_events_org_occurred_idx
  on public.lead_intake_events(organization_id, occurred_at desc);
create index lead_intake_events_endpoint_idx
  on public.lead_intake_events(endpoint_id) where endpoint_id is not null;

alter table public.lead_intake_events enable row level security;

-- Só leitura autenticada (inbox/log). Escrita SEMPRE via
-- lead_intake_submit() (SECURITY DEFINER, service_role only) — nenhuma
-- policy de insert/update é concedida a authenticated/anon aqui.
create policy lead_intake_events_org_select on public.lead_intake_events for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'lead_intake.view')
);

grant select on public.lead_intake_events to authenticated;

commit;
