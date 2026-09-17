begin;

-- ============================================================
-- MUGÔ ONE — Sprint 3 (CRM Commercial Foundation)
-- Permissões comerciais + leads genéricos.
-- ============================================================

insert into public.permissions(code, module, label, sort_order) values
  ('crm.leads.view', 'crm', 'Visualizar leads', 150),
  ('crm.leads.manage', 'crm', 'Gerenciar leads', 151),
  ('crm.deals.view', 'crm', 'Visualizar negócios', 152),
  ('crm.deals.manage', 'crm', 'Gerenciar negócios', 153),
  ('crm.pipelines.manage', 'crm', 'Gerenciar pipelines', 154)
on conflict (code) do nothing;

insert into public.preset_permissions(preset, permission_code) values
  ('gestor', 'crm.leads.view'),
  ('gestor', 'crm.leads.manage'),
  ('gestor', 'crm.deals.view'),
  ('gestor', 'crm.deals.manage'),
  ('gestor', 'crm.pipelines.manage'),
  ('comercial', 'crm.leads.view'),
  ('comercial', 'crm.leads.manage'),
  ('comercial', 'crm.deals.view'),
  ('comercial', 'crm.deals.manage')
on conflict do nothing;

-- Presets já aplicados armazenam grants materializados. Acrescentar os
-- novos códigos preserva a semântica desses presets nas contas atuais.
insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'crm.%'
  and om.permission_preset in ('gestor', 'comercial')
on conflict (organization_id, user_id, permission_code) do nothing;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  email text,
  phone text,
  whatsapp text,
  company_name text,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  customer_id uuid references public.clients(id) on delete set null,
  source text not null default 'manual',
  source_channel text,
  source_medium text,
  source_campaign text,
  source_external_id text,
  attribution_metadata jsonb not null default '{}'::jsonb,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (btrim(status) <> ''),
  temperature text,
  score numeric(5,2) check (score between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_at timestamptz,
  converted_customer_id uuid references public.clients(id) on delete set null,
  converted_deal_id uuid
);

create index leads_org_status_idx on public.leads(organization_id, status, created_at desc);
create index leads_org_owner_idx on public.leads(organization_id, owner_user_id)
  where owner_user_id is not null;
create index leads_org_source_external_idx on public.leads(organization_id, source, source_external_id)
  where source_external_id is not null;

create or replace function public.leads_set_updated_at()
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

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.leads_set_updated_at();

create or replace function public.crm_prevent_organization_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id_is_immutable';
  end if;
  return new;
end;
$$;

create trigger leads_prevent_organization_change
before update of organization_id on public.leads
for each row execute function public.crm_prevent_organization_change();

create or replace function public.leads_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.companies
    where id = new.company_id and organization_id = new.organization_id
  ) then raise exception 'lead_company_organization_mismatch'; end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts
    where id = new.contact_id and organization_id = new.organization_id
  ) then raise exception 'lead_contact_organization_mismatch'; end if;

  if new.customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.customer_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'lead_customer_organization_mismatch'; end if;

  if new.converted_customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.converted_customer_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'lead_converted_customer_organization_mismatch'; end if;

  return new;
end;
$$;

create trigger leads_validate_tenant_refs
before insert or update of organization_id, company_id, contact_id, customer_id, converted_customer_id
on public.leads
for each row execute function public.leads_validate_tenant_refs();

alter table public.leads enable row level security;

create policy leads_org_select on public.leads for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'crm.leads.view')
);

create policy leads_org_insert on public.leads for insert
with check (public.has_org_permission(organization_id, 'crm.leads.manage'));

create policy leads_org_update on public.leads for update
using (public.has_org_permission(organization_id, 'crm.leads.manage'))
with check (public.has_org_permission(organization_id, 'crm.leads.manage'));

create policy leads_org_delete on public.leads for delete
using (public.has_org_permission(organization_id, 'crm.leads.manage'));

grant select, insert, update, delete on public.leads to authenticated;

revoke execute on function public.leads_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.crm_prevent_organization_change()
  from public, anon, authenticated;
revoke execute on function public.leads_validate_tenant_refs()
  from public, anon, authenticated;

commit;
