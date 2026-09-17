begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- messages: source of truth do conteúdo de comunicação (briefing §37)
-- — nunca duplicado em activities/touchpoints/leads. message_type
-- preparado para mídia futura (briefing §7); só texto funciona bem
-- nesta sprint.
--
-- status normalizado entre providers (briefing §8): queued/sent/
-- delivered/read/failed/received. Nenhum status específico de provider
-- vaza para o Core.
-- ============================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (btrim(channel) <> ''),
  message_type text not null default 'text'
    check (message_type in ('text', 'image', 'document', 'audio', 'video', 'template', 'location', 'system')),

  body_text text,

  provider text not null check (btrim(provider) <> ''),
  provider_message_id text,

  sender_identity text,
  recipient_identity text,

  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),

  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,

  error_code text,
  error_message text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- Idempotência (briefing §9): mesmo provider+provider_message_id nunca
-- vira 2 messages — essencial para reprocessar webhook com segurança.
create unique index messages_org_provider_message_idx
  on public.messages(organization_id, provider, provider_message_id)
  where provider_message_id is not null;

create index messages_org_conversation_idx on public.messages(organization_id, conversation_id, created_at);
create index messages_org_status_idx on public.messages(organization_id, status);

alter table public.messages enable row level security;

create policy messages_org_select on public.messages for select
using (
  organization_id in (select public.current_user_org_ids())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.organization_id = messages.organization_id
      and public.has_org_permission(c.organization_id, 'communications.view')
  )
);

grant select on public.messages to authenticated;

-- Escrita só via RPC SECURITY DEFINER (send_communication_message /
-- update_message_delivery_status / simulate_inbound_message) — nenhuma
-- policy de insert/update concedida a authenticated aqui, mesmo padrão
-- de lead_intake_events (Sprint M).

commit;
