begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- fiscal_connections: mesmo modelo de communication_connections
-- (Sprint N) — credentials_reference é só um RÓTULO (nome da env var
-- no ambiente da Edge Function), nunca o segredo em si. Arquitetura
-- comporta tanto conta única da plataforma quanto credencial própria
-- por tenant (briefing §5) sem mudança de schema — a diferença fica
-- em qual env var credentials_reference aponta.
-- ============================================================

create table public.fiscal_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  provider text not null check (btrim(provider) <> ''),
  status text not null default 'not_configured' check (status in ('not_configured', 'connected', 'error')),

  provider_company_id text,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),

  configuration jsonb not null default '{}'::jsonb,
  credentials_reference text,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fiscal_connections_org_idx on public.fiscal_connections(organization_id);
create unique index fiscal_connections_org_provider_idx on public.fiscal_connections(organization_id, provider);

create or replace function public.fiscal_connections_set_updated_at()
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

create trigger fiscal_connections_set_updated_at
before update on public.fiscal_connections
for each row execute function public.fiscal_connections_set_updated_at();

create trigger fiscal_connections_prevent_organization_change
before update of organization_id on public.fiscal_connections
for each row execute function public.crm_prevent_organization_change();

alter table public.fiscal_connections enable row level security;

create policy fiscal_connections_org_select on public.fiscal_connections for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'fiscal.manage')
);
create policy fiscal_connections_org_insert on public.fiscal_connections for insert
with check (public.has_org_permission(organization_id, 'fiscal.manage'));
create policy fiscal_connections_org_update on public.fiscal_connections for update
using (public.has_org_permission(organization_id, 'fiscal.manage'))
with check (public.has_org_permission(organization_id, 'fiscal.manage'));

grant select, insert, update on public.fiscal_connections to authenticated;

commit;
