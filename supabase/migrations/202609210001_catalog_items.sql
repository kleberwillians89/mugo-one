begin;

-- ============================================================
-- MUGÔ ONE — Sprint "Catálogo Universal + Sale Items" (Fase E)
--
-- catalog_items: catálogo genérico de produtos/serviços por
-- organização. Substitui a necessidade de uma tabela vertical como
-- `perfumes` para o Core novo — nenhuma organização nova depende dela.
-- `perfumes` continua existindo, intocada, como legado (ver
-- docs/SALES_CATALOG_MIGRATION_PLAN.md).
--
-- Preferência arquitetural do briefing: uma tabela `catalog_items` com
-- `type` (product|service), não duas tabelas separadas — evita
-- duplicar RLS/índices/UI para o mesmo conceito.
-- ============================================================

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  type text not null check (type in ('product', 'service')),
  name text not null check (btrim(name) <> ''),
  sku text,
  description text,
  category text,

  -- Texto livre, não enum SQL: uma unidade nova para um tenant futuro
  -- (ex.: "consulta", "diária") nunca deve exigir uma migration. A
  -- lista de sugestões (un, kg, g, l, ml, m, cm, hour, day, session,
  -- package, month, service) vive só no frontend, como conveniência de
  -- formulário — 'ml' é uma opção possível entre outras, nunca uma
  -- regra estrutural do catálogo.
  unit text not null default 'un',

  price numeric(14,2) not null default 0 check (price >= 0),
  cost numeric(14,2) check (cost is null or cost >= 0),

  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id)
);

create index catalog_items_org_active_idx
  on public.catalog_items(organization_id, active, name);
create index catalog_items_org_type_idx
  on public.catalog_items(organization_id, type);
create unique index catalog_items_org_sku_idx
  on public.catalog_items(organization_id, sku)
  where sku is not null;

create trigger catalog_items_set_updated_at
before update on public.catalog_items
for each row execute function public.crm_set_updated_at();

create trigger catalog_items_prevent_organization_change
before update of organization_id on public.catalog_items
for each row execute function public.crm_prevent_organization_change();

alter table public.catalog_items enable row level security;

create policy catalog_items_org_select on public.catalog_items for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'catalog.view')
);
create policy catalog_items_org_insert on public.catalog_items for insert
with check (public.has_org_permission(organization_id, 'catalog.manage'));
create policy catalog_items_org_update on public.catalog_items for update
using (public.has_org_permission(organization_id, 'catalog.manage'))
with check (public.has_org_permission(organization_id, 'catalog.manage'));
create policy catalog_items_org_delete on public.catalog_items for delete
using (public.has_org_permission(organization_id, 'catalog.manage'));

grant select, insert, update, delete on public.catalog_items to authenticated;

-- ------------------------------------------------------------
-- Permissões novas: catalog.view / catalog.manage. Catálogo é
-- essencial para Vendas (não existe "Nova venda" sem item para
-- vender), mas não é um módulo que precise de tela própria com
-- permissão adicional para quem já vende — por isso entra também no
-- preset 'comercial' (visualizar) e 'gestor' (tudo, como qualquer
-- outro módulo). 'estoque' ganha só a visualização (precisa ver o
-- catálogo para saber o que está fisicamente no estoque, não precisa
-- criar/editar item comercial).
-- ------------------------------------------------------------

insert into public.permissions (code, module, label, sort_order) values
  ('catalog.view', 'catalog', 'Visualizar catálogo', 50),
  ('catalog.manage', 'catalog', 'Gerenciar catálogo', 51)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code)
select 'gestor', code from public.permissions where code in ('catalog.view', 'catalog.manage')
on conflict do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('comercial', 'catalog.view'),
  ('comercial', 'catalog.manage'),
  ('entregas', 'catalog.view'),
  ('estoque', 'catalog.view')
on conflict do nothing;

-- 'catalog' é core: não existe "Nova venda" sem item para vender, então
-- toda organização (inclusive as criadas antes desta migration) precisa
-- do catálogo habilitado — sem exceção via organization_features.
insert into public.features (code, label, description, is_core) values
  ('catalog', 'Catálogo', 'Produtos e serviços vendáveis pela organização.', true)
on conflict (code) do nothing;

commit;
