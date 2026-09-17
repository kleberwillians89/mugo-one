begin;

-- ============================================================
-- MUGÔ ONE — Sprint 3 (CRM Commercial Foundation)
-- Deals genéricos vinculados a pipeline/stage configuráveis.
-- ============================================================

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id),
  stage_id uuid not null references public.pipeline_stages(id),
  customer_id uuid references public.clients(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  value numeric(14,2) not null default 0 check (value >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  owner_user_id uuid references auth.users(id) on delete set null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  expected_close_date date,
  won_at timestamptz,
  lost_at timestamptz,
  loss_reason text,
  source text not null default 'manual',
  source_channel text,
  source_medium text,
  source_campaign text,
  source_external_id text,
  attribution_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index deals_org_pipeline_stage_idx
  on public.deals(organization_id, pipeline_id, stage_id, updated_at desc);
create index deals_org_owner_idx on public.deals(organization_id, owner_user_id)
  where owner_user_id is not null;
create index deals_org_relations_idx on public.deals(organization_id, customer_id, company_id, contact_id);
create index deals_org_lead_idx on public.deals(organization_id, lead_id) where lead_id is not null;

create trigger deals_set_updated_at
before update on public.deals
for each row execute function public.crm_set_updated_at();

create trigger deals_prevent_organization_change
before update of organization_id on public.deals
for each row execute function public.crm_prevent_organization_change();

create or replace function public.deals_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage_type text;
begin
  select ps.stage_type into v_stage_type
  from public.pipeline_stages ps
  join public.pipelines p on p.id = ps.pipeline_id
  where ps.id = new.stage_id
    and ps.pipeline_id = new.pipeline_id
    and ps.organization_id = new.organization_id
    and p.organization_id = new.organization_id;

  if not found then raise exception 'deal_pipeline_stage_organization_mismatch'; end if;

  if new.customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.customer_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'deal_customer_organization_mismatch'; end if;

  if new.company_id is not null and not exists (
    select 1 from public.companies
    where id = new.company_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'deal_company_organization_mismatch'; end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts
    where id = new.contact_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'deal_contact_organization_mismatch'; end if;

  if new.lead_id is not null and not exists (
    select 1 from public.leads
    where id = new.lead_id and organization_id = new.organization_id
  ) then raise exception 'deal_lead_organization_mismatch'; end if;

  if v_stage_type = 'won' then
    new.won_at = coalesce(new.won_at, now());
    new.lost_at = null;
    new.loss_reason = null;
  elsif v_stage_type = 'lost' then
    new.lost_at = coalesce(new.lost_at, now());
    new.won_at = null;
  else
    new.won_at = null;
    new.lost_at = null;
    new.loss_reason = null;
  end if;

  return new;
end;
$$;

create trigger deals_validate_tenant_refs
before insert or update
on public.deals
for each row execute function public.deals_validate_tenant_refs();

-- A referência circular é adicionada somente depois que deals existe.
alter table public.leads
  add constraint leads_converted_deal_id_fkey
  foreign key (converted_deal_id) references public.deals(id) on delete set null;

create or replace function public.leads_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.companies where id = new.company_id and organization_id = new.organization_id
  ) then raise exception 'lead_company_organization_mismatch'; end if;
  if new.contact_id is not null and not exists (
    select 1 from public.contacts where id = new.contact_id and organization_id = new.organization_id
  ) then raise exception 'lead_contact_organization_mismatch'; end if;
  if new.customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.customer_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'lead_customer_organization_mismatch'; end if;
  if new.converted_customer_id is not null and not exists (
    select 1 from public.clients
    where id = new.converted_customer_id and organization_id = new.organization_id and deleted_at is null
  ) then raise exception 'lead_converted_customer_organization_mismatch'; end if;
  if new.converted_deal_id is not null and not exists (
    select 1 from public.deals
    where id = new.converted_deal_id and organization_id = new.organization_id
  ) then raise exception 'lead_converted_deal_organization_mismatch'; end if;
  return new;
end;
$$;

alter table public.deals enable row level security;

create policy deals_org_select on public.deals for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'crm.deals.view')
);
create policy deals_org_insert on public.deals for insert
with check (public.has_org_permission(organization_id, 'crm.deals.manage'));
create policy deals_org_update on public.deals for update
using (public.has_org_permission(organization_id, 'crm.deals.manage'))
with check (public.has_org_permission(organization_id, 'crm.deals.manage'));
create policy deals_org_delete on public.deals for delete
using (public.has_org_permission(organization_id, 'crm.deals.manage'));

grant select, insert, update, delete on public.deals to authenticated;

revoke execute on function public.deals_validate_tenant_refs()
  from public, anon, authenticated;
revoke execute on function public.leads_validate_tenant_refs()
  from public, anon, authenticated;

commit;
