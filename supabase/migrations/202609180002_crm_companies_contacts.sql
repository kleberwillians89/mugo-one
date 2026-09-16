-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- COMPANIES + CONTACTS
--
-- Nenhuma dependência de tenant específico ou de vocabulário de uma
-- vertical de negócio. RLS no mesmo padrão já usado
-- por clients/sales (current_user_org_ids para leitura, has_org_role
-- admin/manager/operator para escrita — ver docs/AUTHORIZATION_STRATEGY.md
-- sobre por que não introduzimos permissão granular aqui). Semântica
-- completa em docs/CRM_DOMAIN_MODEL.md.
-- ============================================================

-- ------------------------------------------------------------
-- COMPANIES
-- ------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null,
  legal_name text,
  document text,
  email text,
  phone text,
  website text,
  industry text,
  company_size text,
  address_line text,
  address_number text,
  complement text,
  district text,
  city text,
  state text,
  postal_code text,
  country text not null default 'BR',
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active',
  source_channel text,
  source_campaign text,
  source_medium text,
  source_external_id text,
  attribution_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index companies_org_normalized_idx on public.companies(organization_id, normalized_name);
create unique index companies_org_document_unique
  on public.companies(organization_id, document)
  where document is not null and btrim(document) <> '';

create or replace function public.companies_set_updated_at()
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

create trigger companies_set_updated_at
before update on public.companies
for each row
execute function public.companies_set_updated_at();

alter table public.companies enable row level security;

create policy companies_org_select
on public.companies
for select
using (organization_id in (select public.current_user_org_ids()));

create policy companies_org_write
on public.companies
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.companies to authenticated;

-- ------------------------------------------------------------
-- CONTACTS
-- Pertence primariamente a uma COMPANY. `customer_id` é compatibilidade
-- opcional (ver docs/CRM_DOMAIN_MODEL.md) — ambos podem ser null
-- (contato avulso ainda não qualificado).
-- ------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  customer_id uuid references public.clients(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null,
  email text,
  phone text,
  whatsapp_phone text,
  role_title text,
  is_primary boolean not null default false,
  owner_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index contacts_org_normalized_idx on public.contacts(organization_id, normalized_name);
create index contacts_org_company_idx on public.contacts(organization_id, company_id) where company_id is not null;
create index contacts_org_customer_idx on public.contacts(organization_id, customer_id) where customer_id is not null;

create or replace function public.contacts_set_updated_at()
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

create trigger contacts_set_updated_at
before update on public.contacts
for each row
execute function public.contacts_set_updated_at();

-- Empresa A não pode vincular um contact a uma company/customer da
-- Empresa B: a FK sozinha não garante isso (só garante que o UUID
-- existe em algum lugar), então validamos organization_id explicitamente.
create or replace function public.contacts_validate_tenant_refs()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.companies
    where id = new.company_id and organization_id = new.organization_id
  ) then
    raise exception 'contact_company_organization_mismatch';
  end if;

  if new.customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.customer_id and organization_id = new.organization_id
  ) then
    raise exception 'contact_customer_organization_mismatch';
  end if;

  return new;
end;
$$;

create trigger contacts_validate_tenant_refs
before insert or update of company_id, customer_id, organization_id on public.contacts
for each row
execute function public.contacts_validate_tenant_refs();

alter table public.contacts enable row level security;

create policy contacts_org_select
on public.contacts
for select
using (organization_id in (select public.current_user_org_ids()));

create policy contacts_org_write
on public.contacts
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.contacts to authenticated;
