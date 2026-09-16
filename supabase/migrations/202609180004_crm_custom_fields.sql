-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- CUSTOM_FIELDS + CUSTOM_FIELD_VALUES
--
-- Reaproveita entity_belongs_to_organization() definida em
-- 202609180003_crm_tags.sql. Aplicado inicialmente a customer/company/
-- contact (ver docs/CRM_DOMAIN_MODEL.md); estender o check de
-- entity_type quando deal/task/product/sale existirem.
-- ============================================================

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'company', 'contact')),
  name text not null check (btrim(name) <> ''),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  field_type text not null check (field_type in (
    'text', 'textarea', 'number', 'currency', 'date', 'datetime',
    'boolean', 'select', 'multi_select', 'email', 'phone', 'url'
  )),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  position integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, entity_type, key)
);

create index custom_fields_org_entity_idx on public.custom_fields(organization_id, entity_type) where active = true;

create or replace function public.custom_fields_set_updated_at()
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

create trigger custom_fields_set_updated_at
before update on public.custom_fields
for each row
execute function public.custom_fields_set_updated_at();

alter table public.custom_fields enable row level security;

create policy custom_fields_org_select
on public.custom_fields
for select
using (organization_id in (select public.current_user_org_ids()));

create policy custom_fields_org_write
on public.custom_fields
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.custom_fields to authenticated;

-- ------------------------------------------------------------
-- CUSTOM_FIELD_VALUES
-- ------------------------------------------------------------

create table public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  custom_field_id uuid not null references public.custom_fields(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'company', 'contact')),
  entity_id uuid not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (custom_field_id, entity_id)
);

create index custom_field_values_org_entity_idx on public.custom_field_values(organization_id, entity_type, entity_id);

create or replace function public.custom_field_values_set_updated_at()
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

create trigger custom_field_values_set_updated_at
before update on public.custom_field_values
for each row
execute function public.custom_field_values_set_updated_at();

-- Valida duas coisas antes de aceitar a linha: (1) custom_field_id
-- pertence à mesma organização E ao mesmo entity_type declarado na
-- linha (não dá pra gravar um valor de campo de "company" numa row
-- declarada entity_type='contact'); (2) a entidade alvo (entity_id)
-- realmente pertence a esta organização — via entity_belongs_to_organization,
-- a mesma função central usada por entity_tags.
create or replace function public.custom_field_values_validate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_field public.custom_fields;
begin
  select * into v_field from public.custom_fields where id = new.custom_field_id;

  if not found or v_field.organization_id <> new.organization_id then
    raise exception 'custom_field_organization_mismatch';
  end if;

  if v_field.entity_type <> new.entity_type then
    raise exception 'custom_field_entity_type_mismatch';
  end if;

  if not public.entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id) then
    raise exception 'entity_organization_mismatch: % % does not belong to organization %',
      new.entity_type, new.entity_id, new.organization_id;
  end if;

  return new;
end;
$$;

create trigger custom_field_values_validate
before insert or update of custom_field_id, entity_type, entity_id, organization_id on public.custom_field_values
for each row
execute function public.custom_field_values_validate();

alter table public.custom_field_values enable row level security;

create policy custom_field_values_org_select
on public.custom_field_values
for select
using (organization_id in (select public.current_user_org_ids()));

create policy custom_field_values_org_write
on public.custom_field_values
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.custom_field_values to authenticated;
