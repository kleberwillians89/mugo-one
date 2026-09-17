begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- touchpoints: interação atribuída a uma identidade JÁ resolvida
-- (customer/company/contact/lead — deal/sale/conversation/
-- custom_entity_record ficam para quando houver necessidade concreta,
-- briefing §8). É a fonte de verdade para primeiro/último contato —
-- qualquer campo derivado/cache futuro (ex. "last_touch_channel" em
-- clients) precisa ser documentado como derivado, nunca a fonte real.
-- ============================================================

create table public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  entity_type text not null check (entity_type in ('customer', 'company', 'contact', 'lead')),
  entity_id uuid not null,

  lead_id uuid references public.leads(id) on delete set null,
  intake_event_id uuid references public.lead_intake_events(id) on delete set null,

  channel text not null check (btrim(channel) <> ''),
  provider text not null check (btrim(provider) <> ''),
  event_type text not null default 'inbound',

  source text,
  medium text,
  campaign text,
  external_id text,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  click_id text,
  click_id_type text,

  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index touchpoints_org_entity_idx
  on public.touchpoints(organization_id, entity_type, entity_id, occurred_at desc);
create index touchpoints_org_lead_idx
  on public.touchpoints(organization_id, lead_id) where lead_id is not null;
create index touchpoints_org_occurred_idx
  on public.touchpoints(organization_id, occurred_at desc);
create index touchpoints_intake_event_idx
  on public.touchpoints(intake_event_id) where intake_event_id is not null;

create or replace function public.touchpoints_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id) then
    raise exception 'touchpoint_entity_organization_mismatch';
  end if;
  if new.lead_id is not null and not public.entity_belongs_to_organization('lead', new.lead_id, new.organization_id) then
    raise exception 'touchpoint_lead_organization_mismatch';
  end if;
  return new;
end;
$$;

create trigger touchpoints_validate_tenant_refs
before insert or update
on public.touchpoints
for each row execute function public.touchpoints_validate_tenant_refs();

alter table public.touchpoints enable row level security;

-- Gate por permissão da PRÓPRIA entidade (customer→clients.view,
-- lead→crm.leads.view, company/contact→só associação à organização,
-- mesmo critério das tabelas companies/contacts) — não por
-- lead_intake.view, que é a permissão da tela de administração dos
-- endpoints, não da timeline de uma entidade já existente.
create policy touchpoints_org_select on public.touchpoints for select
using (
  organization_id in (select public.current_user_org_ids())
  and (
    (entity_type = 'customer' and public.has_org_permission(organization_id, 'clients.view'))
    or (entity_type = 'lead' and public.has_org_permission(organization_id, 'crm.leads.view'))
    or entity_type in ('company', 'contact')
  )
);

grant select on public.touchpoints to authenticated;

revoke execute on function public.touchpoints_validate_tenant_refs() from public, anon, authenticated;

commit;
