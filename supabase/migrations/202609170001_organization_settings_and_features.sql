-- ============================================================
-- MUGÔ ONE — Productização (Sprint 1)
-- Organization Settings + Feature Modules
--
-- Objetivo: parar de hardcodar configuração de uma única empresa
-- (RUAH) no código e preparar a arquitetura de módulos ativáveis
-- por organização. Nenhuma tabela, função ou policy existente é
-- alterada nesta migration — apenas duas tabelas novas e seus
-- helpers, seguindo exatamente o mesmo padrão de RLS já usado no
-- resto do schema (current_user_org_ids / has_org_role).
-- ============================================================

-- ------------------------------------------------------------
-- ORGANIZATION SETTINGS
-- Configuração de identidade/locale por organização. Não expomos
-- todo o frontend ainda — o objetivo deste sprint é só parar de
-- hardcodar (moeda, timezone, domínio, marca) em constantes de
-- código-fonte.
-- ------------------------------------------------------------

create table if not exists public.organization_settings (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  company_name text,
  legal_name text,
  document text,
  email text,
  phone text,
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  locale text not null default 'pt-BR',
  logo_url text,
  primary_color text,
  country text not null default 'BR',
  -- Metadata livre por organização (ex: domínio de login interno,
  -- flags específicas) — evita criar uma coluna nova a cada
  -- necessidade pontual de uma única empresa.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.organization_settings_set_updated_at()
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

drop trigger if exists organization_settings_set_updated_at
  on public.organization_settings;

create trigger organization_settings_set_updated_at
before update on public.organization_settings
for each row
execute function public.organization_settings_set_updated_at();

alter table public.organization_settings enable row level security;

create policy organization_settings_select
on public.organization_settings
for select
using (organization_id in (select public.current_user_org_ids()));

create policy organization_settings_write
on public.organization_settings
for all
using (public.has_org_role(organization_id, array['admin']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin']::public.member_role[]));

grant select, insert, update on public.organization_settings to authenticated;

-- Backfill: uma linha por organização existente. Só preenchemos o
-- que já sabemos (nome) — o resto fica null em vez de inventado.
insert into public.organization_settings (organization_id, company_name)
select o.id, o.name
from public.organizations o
on conflict (organization_id) do nothing;

-- ------------------------------------------------------------
-- FEATURE MODULES
-- Catálogo global de módulos + ativação por organização. Preparo
-- de arquitetura apenas — nenhuma página/rota é bloqueada por isto
-- neste sprint.
-- ------------------------------------------------------------

create table if not exists public.features (
  code text primary key,
  label text not null,
  description text,
  is_core boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.features enable row level security;

create policy features_select
on public.features
for select
using (true);

grant select on public.features to authenticated, anon;

insert into public.features (code, label, description, is_core) values
  ('crm', 'CRM', 'Clientes, empresas, contatos e histórico comercial.', true),
  ('tasks', 'Tarefas', 'Fila e organização de tarefas operacionais.', true),
  ('sales', 'Vendas', 'Registro e acompanhamento de vendas.', true),
  ('inventory', 'Estoque', 'Controle de estoque e alocações.', false),
  ('shipping', 'Entregas', 'Logística e integrações de frete.', false),
  ('communications', 'Comunicação', 'Canais de WhatsApp, e-mail e SMS.', false),
  ('automations', 'Automações', 'Motor de automação (trigger/condição/ação).', false),
  ('ai', 'Inteligência artificial', 'Respostas e insights sobre dados agregados.', false),
  ('customer_portal', 'Portal do cliente', 'Área de acesso self-service do cliente final.', false),
  ('fiscal', 'Fiscal', 'Emissão de documentos fiscais.', false)
on conflict (code) do nothing;

create table if not exists public.organization_features (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  feature_code text not null
    references public.features(code) on delete cascade,
  enabled boolean not null default true,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id),

  primary key (organization_id, feature_code)
);

alter table public.organization_features enable row level security;

create policy organization_features_select
on public.organization_features
for select
using (organization_id in (select public.current_user_org_ids()));

create policy organization_features_write
on public.organization_features
for all
using (public.has_org_role(organization_id, array['admin']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin']::public.member_role[]));

grant select, insert, update, delete on public.organization_features to authenticated;

-- has_organization_feature: mesmo padrão de has_org_role/has_org_permission
-- (security definer, filtrado sempre por organization_id explícito).
-- Módulo "core" (is_core=true) é considerado habilitado por padrão
-- quando não há linha explícita em organization_features.
-- SECURITY DEFINER contorna RLS de organization_features/features, então
-- a função tem que checar membership sozinha (não basta receber
-- p_organization_id como parâmetro) — mesmo predicado já usado nas
-- policies de select deste arquivo (current_user_org_ids()). Sem isso,
-- qualquer usuário autenticado poderia consultar feature flags de
-- qualquer organização, não só a própria.
create or replace function public.has_organization_feature(
  p_organization_id uuid,
  p_feature_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_organization_id in (select public.current_user_org_ids())
    and coalesce(
      (
        select of.enabled
        from public.organization_features of
        where of.organization_id = p_organization_id
          and of.feature_code = p_feature_code
      ),
      exists (
        select 1 from public.features f
        where f.code = p_feature_code and f.is_core = true
      )
    );
$$;

grant execute on function public.has_organization_feature(uuid, text) to authenticated;

-- Backfill: habilita, para a organização já existente (RUAH), só os
-- módulos que já estão em uso real hoje — nada além disso.
insert into public.organization_features (organization_id, feature_code, enabled)
select o.id, f.code, true
from public.organizations o
cross join (values
  ('crm'), ('tasks'), ('sales'), ('inventory'), ('shipping'),
  ('communications'), ('ai'), ('customer_portal')
) as f(code)
on conflict (organization_id, feature_code) do nothing;
