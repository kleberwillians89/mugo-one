-- ============================================================
-- MUGÔ ONE
-- Core Foundation
-- Multi-tenant + Auth + Permissions + Privacy/LGPD + Audit
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

do $$ begin
  create type public.organization_status as enum (
    'trial',
    'active',
    'suspended',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.organization_role as enum (
    'owner',
    'admin',
    'manager',
    'operator',
    'viewer'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.member_status as enum (
    'invited',
    'active',
    'suspended'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.legal_document_type as enum (
    'terms',
    'privacy',
    'dpa',
    'cookies'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.privacy_request_type as enum (
    'access',
    'correction',
    'deletion',
    'portability',
    'consent_revocation',
    'objection',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.privacy_request_status as enum (
    'open',
    'in_review',
    'completed',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- PROFILES
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ORGANIZATIONS
-- Cada empresa é um tenant independente.
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.organization_status not null default 'trial',
  logo_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organizations_name_not_empty
    check (length(trim(name)) > 1),

  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- ============================================================
-- ORGANIZATION MEMBERS
-- Um usuário pode participar de várias empresas.
-- ============================================================

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  role public.organization_role not null default 'viewer',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists idx_organization_members_org
  on public.organization_members(organization_id);

create index if not exists idx_organization_members_user
  on public.organization_members(user_id);

-- ============================================================
-- DOCUMENTOS LEGAIS / LGPD
-- ============================================================

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type public.legal_document_type not null,
  version text not null,
  title text not null,
  content_url text,
  content_hash text,
  is_active boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),

  unique(document_type, version)
);

-- ============================================================
-- ACEITES
-- Nunca atualizar um aceite antigo.
-- Nova versão = novo registro.
-- ============================================================

create table if not exists public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id) on delete cascade,
  legal_document_id uuid not null
    references public.legal_documents(id),
  acceptance_context jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),

  unique(user_id, legal_document_id)
);

-- ============================================================
-- SOLICITAÇÕES LGPD
-- ============================================================

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id) on delete cascade,
  organization_id uuid
    references public.organizations(id) on delete set null,
  request_type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'open',
  details text,
  resolution_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ============================================================
-- AUDITORIA
-- ============================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid
    references public.organizations(id) on delete set null,
  actor_user_id uuid
    references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_org_created
  on public.audit_logs(organization_id, created_at desc);

-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.set_updated_at()
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

drop trigger if exists profiles_set_updated_at on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

drop trigger if exists organization_members_set_updated_at
  on public.organization_members;

create trigger organization_members_set_updated_at
before update on public.organization_members
for each row
execute function public.set_updated_at();

-- ============================================================
-- PROFILE AUTOMÁTICO AO CRIAR USUÁRIO
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    full_name
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ============================================================
-- HELPERS MULTI-TENANT
-- ============================================================

create or replace function public.is_organization_member(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  p_organization_id uuid,
  p_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role = any(p_roles)
  );
$$;

-- ============================================================
-- RPC: CRIAR EMPRESA
-- Cria organização + proprietário atomicamente.
-- ============================================================

create or replace function public.create_organization(
  p_name text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(p_name)) < 2 then
    raise exception 'Invalid organization name';
  end if;

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Invalid organization slug';
  end if;

  insert into public.organizations (
    name,
    slug,
    created_by
  )
  values (
    trim(p_name),
    v_slug,
    v_user_id
  )
  returning id into v_organization_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (
    v_organization_id,
    v_user_id,
    'owner',
    'active'
  );

  return v_organization_id;
end;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.legal_documents enable row level security;
alter table public.user_legal_acceptances enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES

create policy "users_can_read_own_profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "users_can_update_own_profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ORGANIZATIONS

create policy "members_can_read_organization"
on public.organizations
for select
to authenticated
using (
  public.is_organization_member(id)
);

create policy "owners_admins_can_update_organization"
on public.organizations
for update
to authenticated
using (
  public.has_organization_role(
    id,
    array['owner', 'admin']::public.organization_role[]
  )
)
with check (
  public.has_organization_role(
    id,
    array['owner', 'admin']::public.organization_role[]
  )
);

-- ORGANIZATION MEMBERS
-- Nesta primeira versão, alterações de equipe serão feitas
-- por RPCs seguras que criaremos na próxima etapa.

create policy "members_can_read_members"
on public.organization_members
for select
to authenticated
using (
  public.is_organization_member(organization_id)
);

-- LEGAL DOCUMENTS

create policy "public_can_read_active_legal_documents"
on public.legal_documents
for select
to anon, authenticated
using (is_active = true);

-- LEGAL ACCEPTANCES

create policy "users_can_read_own_acceptances"
on public.user_legal_acceptances
for select
to authenticated
using (user_id = auth.uid());

create policy "users_can_accept_documents"
on public.user_legal_acceptances
for insert
to authenticated
with check (user_id = auth.uid());

-- PRIVACY REQUESTS

create policy "users_can_read_own_privacy_requests"
on public.privacy_requests
for select
to authenticated
using (user_id = auth.uid());

create policy "users_can_create_privacy_requests"
on public.privacy_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    organization_id is null
    or public.is_organization_member(organization_id)
  )
);

-- AUDIT LOGS
-- Cliente não insere nem altera logs diretamente.
-- Escrita será feita pelo backend/Edge Functions.

create policy "owners_admins_can_read_audit_logs"
on public.audit_logs
for select
to authenticated
using (
  organization_id is not null
  and public.has_organization_role(
    organization_id,
    array['owner', 'admin']::public.organization_role[]
  )
);

-- ============================================================
-- GRANTS
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select, update
  on public.profiles
  to authenticated;

grant select, update
  on public.organizations
  to authenticated;

grant select
  on public.organization_members
  to authenticated;

grant select
  on public.legal_documents
  to anon, authenticated;

grant select, insert
  on public.user_legal_acceptances
  to authenticated;

grant select, insert
  on public.privacy_requests
  to authenticated;

grant select
  on public.audit_logs
  to authenticated;

grant execute
  on function public.create_organization(text, text)
  to authenticated;

grant execute
  on function public.is_organization_member(uuid)
  to authenticated;

grant execute
  on function public.has_organization_role(
    uuid,
    public.organization_role[]
  )
  to authenticated;

