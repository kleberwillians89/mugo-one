begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- organization_fiscal_profiles: só o que é GENUINAMENTE fiscal e não
-- existe em organization_settings (legal_name/company_name/document
-- continuam lá — reaproveitados na hora do snapshot, não duplicados
-- aqui, briefing §7). tax_regime é um RÓTULO configurado pela empresa
-- com orientação contábil própria — nunca usado pelo Core para
-- decidir nada (briefing "REGRA FUNDAMENTAL").
-- ============================================================

create table public.organization_fiscal_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,

  state_registration text,
  municipal_registration text,
  tax_regime text,

  address_line text,
  address_number text,
  complement text,
  district text,
  city text,
  state text,
  postal_code text,
  -- Código IBGE do município — exigido por integrações de NFS-e
  -- (cada município tem sua própria prefeitura/regra); nunca inferido,
  -- sempre configurado.
  city_code text,

  nfse_enabled boolean not null default false,
  nfe_enabled boolean not null default false,
  nfce_enabled boolean not null default false,

  default_environment text not null default 'sandbox' check (default_environment in ('sandbox', 'production')),

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.organization_fiscal_profiles_set_updated_at()
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

create trigger organization_fiscal_profiles_set_updated_at
before update on public.organization_fiscal_profiles
for each row execute function public.organization_fiscal_profiles_set_updated_at();

create trigger organization_fiscal_profiles_prevent_organization_change
before update of organization_id on public.organization_fiscal_profiles
for each row execute function public.crm_prevent_organization_change();

alter table public.organization_fiscal_profiles enable row level security;

create policy organization_fiscal_profiles_org_select on public.organization_fiscal_profiles for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'fiscal.view')
);
create policy organization_fiscal_profiles_org_insert on public.organization_fiscal_profiles for insert
with check (public.has_org_permission(organization_id, 'fiscal.manage'));
create policy organization_fiscal_profiles_org_update on public.organization_fiscal_profiles for update
using (public.has_org_permission(organization_id, 'fiscal.manage'))
with check (public.has_org_permission(organization_id, 'fiscal.manage'));

grant select, insert, update on public.organization_fiscal_profiles to authenticated;

commit;
