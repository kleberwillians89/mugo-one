begin;

-- ============================================================
-- MUGÔ ONE — Sprint "Catálogo Universal + Sale Items" (Fase E)
--
-- sale_items: uma venda pode ter 1 ou N itens. `catalog_item_id` é
-- nullable de propósito (item livre/manual, comum em serviços — ex.:
-- "Consultoria estratégica setembro" sem entrada de catálogo), mas
-- `description` é sempre preenchida na própria linha para preservar o
-- histórico mesmo se o catalog_item for editado/desativado depois.
-- ============================================================

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,

  description text not null check (btrim(description) <> ''),
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'un',
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),

  metadata jsonb not null default '{}'::jsonb,
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sale_items_org_sale_idx
  on public.sale_items(organization_id, sale_id, position);
create index sale_items_org_catalog_item_idx
  on public.sale_items(organization_id, catalog_item_id)
  where catalog_item_id is not null;

create trigger sale_items_set_updated_at
before update on public.sale_items
for each row execute function public.crm_set_updated_at();

create trigger sale_items_prevent_organization_change
before update of organization_id on public.sale_items
for each row execute function public.crm_prevent_organization_change();

-- Mesmo padrão de deals_validate_tenant_refs: SECURITY DEFINER porque
-- RLS de `sales`/`catalog_items` não é visível de dentro de um trigger
-- de outra tabela sem isso, mas a checagem em si é sempre explícita
-- por organization_id — nunca confia em RLS implícito.
create or replace function public.sale_items_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sales
    where id = new.sale_id and organization_id = new.organization_id
  ) then raise exception 'sale_item_sale_organization_mismatch'; end if;

  if new.catalog_item_id is not null and not exists (
    select 1 from public.catalog_items
    where id = new.catalog_item_id and organization_id = new.organization_id
  ) then raise exception 'sale_item_catalog_item_organization_mismatch'; end if;

  return new;
end;
$$;

create trigger sale_items_validate_tenant_refs
before insert or update
on public.sale_items
for each row execute function public.sale_items_validate_tenant_refs();

alter table public.sale_items enable row level security;

create policy sale_items_org_select on public.sale_items for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'sales.view')
);
create policy sale_items_org_insert on public.sale_items for insert
with check (public.has_org_permission(organization_id, 'sales.create'));
create policy sale_items_org_update on public.sale_items for update
using (public.has_org_permission(organization_id, 'sales.edit'))
with check (public.has_org_permission(organization_id, 'sales.edit'));
create policy sale_items_org_delete on public.sale_items for delete
using (public.has_org_permission(organization_id, 'sales.edit'));

grant select, insert, update, delete on public.sale_items to authenticated;

revoke execute on function public.sale_items_validate_tenant_refs()
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- entity_belongs_to_organization ganha o case 'sale' — sem isso,
-- log_activity() para uma venda falha com entity_organization_mismatch
-- (ver docs/SALES_CATALOG_MIGRATION_PLAN.md §1). Aditivo: create or
-- replace, nenhum case existente é alterado.
-- ------------------------------------------------------------

create or replace function public.entity_belongs_to_organization(p_entity_type text, p_entity_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  case p_entity_type
    when 'customer' then
      select exists(select 1 from public.clients where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'company' then
      select exists(select 1 from public.companies where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'contact' then
      select exists(select 1 from public.contacts where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'lead' then
      select exists(select 1 from public.leads where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'deal' then
      select exists(select 1 from public.deals where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'sale' then
      select exists(select 1 from public.sales where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'catalog_item' then
      select exists(select 1 from public.catalog_items where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    else
      v_found := false;
  end case;
  return coalesce(v_found, false);
end;
$$;

commit;
