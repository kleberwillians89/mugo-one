begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- organization_collection_settings: só o que é GENUINAMENTE de
-- cobrança e não existe em organization_settings/organization_fiscal_
-- profiles (company_name/legal_name/document continuam lá — nunca
-- duplicados aqui, briefing §4). Nada aqui é obrigatório: PIX,
-- transferência e link de pagamento são todos opcionais e
-- individualmente ativáveis (briefing §6/§7) — uma organização pode
-- usar só payment_instructions em texto livre.
--
-- payment_link_url não estava na lista literal do briefing (só
-- payment_link_enabled), mas um link "habilitado" sem endereço não
-- tem uso — adicionado como o campo de valor natural do toggle.
-- ============================================================

create table public.organization_collection_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,

  display_name text,
  payment_instructions text,

  pix_enabled boolean not null default false,
  pix_key_type text check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key text,
  pix_holder_name text,

  bank_transfer_enabled boolean not null default false,
  bank_name text,
  bank_agency text,
  bank_account text,
  bank_account_holder text,

  payment_link_enabled boolean not null default false,
  payment_link_url text,

  default_due_days integer not null default 7 check (default_due_days >= 0 and default_due_days <= 365),
  late_fee_text text,
  interest_text text,

  support_phone text,
  support_email text,
  footer_text text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.organization_collection_settings_set_updated_at()
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

create trigger organization_collection_settings_set_updated_at
before update on public.organization_collection_settings
for each row execute function public.organization_collection_settings_set_updated_at();

create trigger organization_collection_settings_prevent_organization_change
before update of organization_id on public.organization_collection_settings
for each row execute function public.crm_prevent_organization_change();

alter table public.organization_collection_settings enable row level security;

-- PIX/dados bancários nunca cruzam organização (briefing §30) — select
-- exige a mesma permissão de configuração, nunca um SELECT aberto a
-- qualquer membro autenticado.
create policy organization_collection_settings_org_select on public.organization_collection_settings for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'collections.configure')
);
create policy organization_collection_settings_org_insert on public.organization_collection_settings for insert
with check (public.has_org_permission(organization_id, 'collections.configure'));
create policy organization_collection_settings_org_update on public.organization_collection_settings for update
using (public.has_org_permission(organization_id, 'collections.configure'))
with check (public.has_org_permission(organization_id, 'collections.configure'));

grant select, insert, update on public.organization_collection_settings to authenticated;

commit;
