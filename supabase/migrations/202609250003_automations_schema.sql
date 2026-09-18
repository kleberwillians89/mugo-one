begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- automations: nasce sempre 'draft' (briefing §11 — nunca ativa
-- silenciosamente). trigger_type = um domain_events.event_type
-- (texto livre, mesmo racional de channel na Sprint M/N — não um enum
-- rígido, novos eventos não exigem migration). on_error controla o
-- comportamento entre actions (briefing §58 — "evitar comportamento
-- implícito", por isso é uma coluna explícita, não uma regra oculta).
-- ============================================================

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name text not null check (btrim(name) <> ''),
  description text,

  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),

  trigger_type text not null check (btrim(trigger_type) <> ''),
  on_error text not null default 'continue' check (on_error in ('continue', 'stop')),

  version integer not null default 1,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  enabled_by uuid references public.profiles(id),
  enabled_at timestamptz,
  disabled_at timestamptz
);

create index automations_org_status_idx on public.automations(organization_id, status);
create index automations_org_trigger_idx on public.automations(organization_id, trigger_type) where status = 'active';

create or replace function public.automations_set_updated_at()
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

create trigger automations_set_updated_at
before update on public.automations
for each row execute function public.automations_set_updated_at();

create trigger automations_prevent_organization_change
before update of organization_id on public.automations
for each row execute function public.crm_prevent_organization_change();

alter table public.automations enable row level security;

create policy automations_org_select on public.automations for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'automations.view')
);

grant select on public.automations to authenticated;

-- ============================================================
-- automation_conditions: AND simples nesta versão (briefing §13 —
-- "não criar árvore lógica infinita se não houver necessidade"; zero
-- conditions = sempre executa). field_path é resolvido por um
-- whitelist explícito no avaliador (nunca SQL arbitrário — briefing
-- §14), não aqui no schema.
-- ============================================================

create table public.automation_conditions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,

  field_path text not null check (btrim(field_path) <> ''),
  operator text not null check (operator in (
    'equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty',
    'greater_than', 'less_than', 'in', 'not_in'
  )),
  value jsonb,

  position integer not null default 0,

  created_at timestamptz not null default now()
);

create index automation_conditions_automation_idx on public.automation_conditions(automation_id, position);

alter table public.automation_conditions enable row level security;

create policy automation_conditions_org_select on public.automation_conditions for select
using (exists (
  select 1 from public.automations a
  where a.id = automation_conditions.automation_id
    and a.organization_id in (select public.current_user_org_ids())
    and public.has_org_permission(a.organization_id, 'automations.view')
));

grant select on public.automation_conditions to authenticated;

-- ============================================================
-- automation_actions: create_task/send_email na primeira versão
-- (briefing §16/§17/§18). configuration é jsonb validado pelo
-- executor da action, não pelo schema (mesma divisão de
-- responsabilidade de communication_connections.configuration).
-- ============================================================

create table public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,

  action_type text not null check (action_type in ('create_task', 'send_email')),
  configuration jsonb not null default '{}'::jsonb,

  position integer not null default 0,
  enabled boolean not null default true,

  created_at timestamptz not null default now()
);

create index automation_actions_automation_idx on public.automation_actions(automation_id, position);

alter table public.automation_actions enable row level security;

create policy automation_actions_org_select on public.automation_actions for select
using (exists (
  select 1 from public.automations a
  where a.id = automation_actions.automation_id
    and a.organization_id in (select public.current_user_org_ids())
    and public.has_org_permission(a.organization_id, 'automations.view')
));

grant select on public.automation_actions to authenticated;

commit;
