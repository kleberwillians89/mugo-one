begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- communication_connections: foundation genérica de conexão de
-- provider por organização (briefing §14). Segredo NUNCA aqui —
-- credentials_reference é só um rótulo (ex.: nome da env var no
-- ambiente da Edge Function), nunca o token em si (briefing §15).
-- configuration é jsonb NÃO-sensível (from_email, from_name, domínio
-- verificado etc.).
-- ============================================================

create table public.communication_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  provider text not null check (btrim(provider) <> ''),
  channel text not null check (btrim(channel) <> ''),

  name text not null check (btrim(name) <> ''),
  status text not null default 'not_configured' check (status in ('not_configured', 'connected', 'error', 'disabled')),

  external_account_id text,
  credentials_reference text,
  configuration jsonb not null default '{}'::jsonb,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index communication_connections_org_idx on public.communication_connections(organization_id);
create index communication_connections_org_channel_idx on public.communication_connections(organization_id, channel);

create or replace function public.communication_connections_set_updated_at()
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

create trigger communication_connections_set_updated_at
before update on public.communication_connections
for each row execute function public.communication_connections_set_updated_at();

create trigger communication_connections_prevent_organization_change
before update of organization_id on public.communication_connections
for each row execute function public.crm_prevent_organization_change();

alter table public.communication_connections enable row level security;

create policy communication_connections_org_select on public.communication_connections for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'communications.manage')
);
create policy communication_connections_org_insert on public.communication_connections for insert
with check (public.has_org_permission(organization_id, 'communications.manage'));
create policy communication_connections_org_update on public.communication_connections for update
using (public.has_org_permission(organization_id, 'communications.manage'))
with check (public.has_org_permission(organization_id, 'communications.manage'));

grant select, insert, update on public.communication_connections to authenticated;

commit;
