begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- conversations: entidade universal de conversa (briefing §3). O Core
-- só entende Conversation/Message/Participant/Channel/Direction/
-- Status — nunca ManyChat/Meta/Resend/GTI/Zenvia/Twilio diretamente.
--
-- channel é texto livre (whatsapp/email/sms/instagram/webchat/other
-- são exemplos, não enum rígido — briefing §4, mesmo racional de
-- lead_intake_events.channel na Sprint M).
--
-- connection_id (não pedido literalmente pelo briefing, mas necessário
-- operacionalmente): qual communication_connections usar ao enviar —
-- ver docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §4.
-- ============================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  channel text not null check (btrim(channel) <> ''),

  customer_id uuid references public.clients(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,

  status text not null default 'open' check (status in ('open', 'pending', 'closed')),

  assigned_user_id uuid references auth.users(id) on delete set null,

  subject text,

  external_thread_id text,
  provider text,
  provider_account_id text,
  connection_id uuid references public.communication_connections(id) on delete set null,

  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,

  unread_count integer not null default 0 check (unread_count >= 0),

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Idempotência de thread: mesmo provider+external_thread_id nunca vira
-- 2 conversations (briefing §9, mesmo princípio aplicado a thread em
-- vez de mensagem individual).
create unique index conversations_org_provider_thread_idx
  on public.conversations(organization_id, provider, external_thread_id)
  where provider is not null and external_thread_id is not null;

create index conversations_org_status_idx on public.conversations(organization_id, status, last_message_at desc);
create index conversations_org_assignee_idx on public.conversations(organization_id, assigned_user_id)
  where assigned_user_id is not null;
create index conversations_org_customer_idx on public.conversations(organization_id, customer_id) where customer_id is not null;
create index conversations_org_lead_idx on public.conversations(organization_id, lead_id) where lead_id is not null;
create index conversations_org_company_idx on public.conversations(organization_id, company_id) where company_id is not null;
create index conversations_org_contact_idx on public.conversations(organization_id, contact_id) where contact_id is not null;

create or replace function public.conversations_set_updated_at()
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

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.conversations_set_updated_at();

create trigger conversations_prevent_organization_change
before update of organization_id on public.conversations
for each row execute function public.crm_prevent_organization_change();

-- Tenant-safety das 4 entidades relacionáveis + do assignee (membro
-- ativo da mesma org) — mesmo padrão de tasks_validate_tenant_refs
-- (Sprint K/L). Todas as 4 são nullable e independentes entre si
-- (uma conversation pode não ter nenhuma, briefing §11: "criar
-- Conversation sem customer").
create or replace function public.conversations_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not public.entity_belongs_to_organization('customer', new.customer_id, new.organization_id) then
    raise exception 'conversation_customer_organization_mismatch';
  end if;
  if new.company_id is not null and not public.entity_belongs_to_organization('company', new.company_id, new.organization_id) then
    raise exception 'conversation_company_organization_mismatch';
  end if;
  if new.contact_id is not null and not public.entity_belongs_to_organization('contact', new.contact_id, new.organization_id) then
    raise exception 'conversation_contact_organization_mismatch';
  end if;
  if new.lead_id is not null and not public.entity_belongs_to_organization('lead', new.lead_id, new.organization_id) then
    raise exception 'conversation_lead_organization_mismatch';
  end if;
  if new.connection_id is not null and not exists (
    select 1 from public.communication_connections where id = new.connection_id and organization_id = new.organization_id
  ) then
    raise exception 'conversation_connection_organization_mismatch';
  end if;

  if new.assigned_user_id is not null
     and (tg_op = 'INSERT' or new.assigned_user_id is distinct from old.assigned_user_id) then
    if not exists (
      select 1 from public.organization_members
      where organization_id = new.organization_id
        and user_id = new.assigned_user_id
        and status = 'active'
    ) then
      raise exception 'conversation_assignee_not_active_member';
    end if;
  end if;

  return new;
end;
$$;

create trigger conversations_validate_tenant_refs
before insert or update
on public.conversations
for each row execute function public.conversations_validate_tenant_refs();

alter table public.conversations enable row level security;

create policy conversations_org_select on public.conversations for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'communications.view')
);

grant select on public.conversations to authenticated;

revoke execute on function public.conversations_validate_tenant_refs() from public, anon, authenticated;

commit;
