begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- automation_runs/automation_action_runs: execução nunca é apagada,
-- mesmo em falha (briefing §31 — dead letter visível, nunca some).
-- Idempotência: no máximo 1 run por (automation_id, event_id,
-- automation_version) — reprocessar o mesmo evento 3x nunca cria 3
-- runs (briefing §23).
-- ============================================================

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  event_id uuid not null references public.domain_events(id) on delete cascade,
  automation_version integer not null,

  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partially_failed', 'failed', 'skipped')),

  started_at timestamptz,
  finished_at timestamptz,

  error_code text,
  error_message text,

  created_at timestamptz not null default now()
);

create unique index automation_runs_idempotency_idx
  on public.automation_runs(automation_id, event_id, automation_version);
create index automation_runs_org_automation_idx on public.automation_runs(organization_id, automation_id, created_at desc);

alter table public.automation_runs enable row level security;

create policy automation_runs_org_select on public.automation_runs for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'automations.view')
);

grant select on public.automation_runs to authenticated;

create table public.automation_action_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  automation_run_id uuid not null references public.automation_runs(id) on delete cascade,
  automation_action_id uuid not null references public.automation_actions(id) on delete cascade,

  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),

  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb not null default '{}'::jsonb,

  attempt_count integer not null default 1 check (attempt_count > 0),

  started_at timestamptz,
  finished_at timestamptz,

  error_code text,
  error_message text,

  created_at timestamptz not null default now()
);

create index automation_action_runs_run_idx on public.automation_action_runs(automation_run_id);
create index automation_action_runs_org_status_idx on public.automation_action_runs(organization_id, status);

alter table public.automation_action_runs enable row level security;

create policy automation_action_runs_org_select on public.automation_action_runs for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'automations.view')
);

grant select on public.automation_action_runs to authenticated;

commit;
