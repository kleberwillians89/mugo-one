begin;

-- ============================================================
-- MUGÔ ONE — Sprint 3 (CRM Commercial Foundation)
-- Pipelines e stages configuráveis por organização.
-- Nenhum nome de stage é fixado pelo Core.
-- ============================================================

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  is_default boolean not null default false,
  active boolean not null default true,
  position integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index pipelines_one_active_default_per_org_idx
  on public.pipelines(organization_id)
  where is_default and active;
create index pipelines_org_position_idx on public.pipelines(organization_id, position, name);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  position integer not null default 0,
  color text,
  stage_type text not null default 'open' check (stage_type in ('open', 'won', 'lost')),
  probability numeric(5,2) not null default 0 check (probability between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, pipeline_id, organization_id),
  unique (pipeline_id, position)
);

create index pipeline_stages_org_pipeline_idx
  on public.pipeline_stages(organization_id, pipeline_id, position);

create or replace function public.crm_set_updated_at()
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

create trigger pipelines_set_updated_at
before update on public.pipelines
for each row execute function public.crm_set_updated_at();

create trigger pipeline_stages_set_updated_at
before update on public.pipeline_stages
for each row execute function public.crm_set_updated_at();

create trigger pipelines_prevent_organization_change
before update of organization_id on public.pipelines
for each row execute function public.crm_prevent_organization_change();

create trigger pipeline_stages_prevent_organization_change
before update of organization_id on public.pipeline_stages
for each row execute function public.crm_prevent_organization_change();

create or replace function public.pipeline_stages_validate_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.pipelines
    where id = new.pipeline_id and organization_id = new.organization_id
  ) then raise exception 'pipeline_stage_organization_mismatch'; end if;
  return new;
end;
$$;

create trigger pipeline_stages_validate_tenant
before insert or update of organization_id, pipeline_id on public.pipeline_stages
for each row execute function public.pipeline_stages_validate_tenant();

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;

create policy pipelines_org_select on public.pipelines for select
using (
  organization_id in (select public.current_user_org_ids())
  and (
    public.has_org_permission(organization_id, 'crm.leads.view')
    or public.has_org_permission(organization_id, 'crm.deals.view')
    or public.has_org_permission(organization_id, 'crm.pipelines.manage')
  )
);
create policy pipelines_org_write on public.pipelines for all
using (public.has_org_permission(organization_id, 'crm.pipelines.manage'))
with check (public.has_org_permission(organization_id, 'crm.pipelines.manage'));

create policy pipeline_stages_org_select on public.pipeline_stages for select
using (
  organization_id in (select public.current_user_org_ids())
  and (
    public.has_org_permission(organization_id, 'crm.leads.view')
    or public.has_org_permission(organization_id, 'crm.deals.view')
    or public.has_org_permission(organization_id, 'crm.pipelines.manage')
  )
);
create policy pipeline_stages_org_write on public.pipeline_stages for all
using (public.has_org_permission(organization_id, 'crm.pipelines.manage'))
with check (public.has_org_permission(organization_id, 'crm.pipelines.manage'));

grant select, insert, update, delete on public.pipelines to authenticated;
grant select, insert, update, delete on public.pipeline_stages to authenticated;

revoke execute on function public.crm_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.pipeline_stages_validate_tenant()
  from public, anon, authenticated;

commit;
