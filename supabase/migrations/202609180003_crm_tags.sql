-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- TAGS + entity_belongs_to_organization (validação polimórfica central)
--
-- entity_belongs_to_organization()/validate_entity_tenant_ownership()
-- são definidas aqui (primeira tabela polimórfica) e reaproveitadas
-- pelas próximas migrations desta sprint (custom_field_values, notes,
-- activities) — sem duplicar a lógica de validação em cada tabela.
-- Ver docs/CRM_DOMAIN_MODEL.md, seção "Tags, Custom Fields, Notes,
-- Activities — por que são polimórficas".
-- ============================================================

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null,
  color text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  unique (organization_id, normalized_name)
);

alter table public.tags enable row level security;

create policy tags_org_select
on public.tags
for select
using (organization_id in (select public.current_user_org_ids()));

create policy tags_org_write
on public.tags
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.tags to authenticated;

-- ------------------------------------------------------------
-- Validação central de propriedade tenant para colunas
-- entity_type/entity_id polimórficas. Hoje só sabe validar os tipos que
-- já existem e têm tabela própria; qualquer entity_type fora da lista
-- retorna false (nega por padrão, nunca aceita um tipo que não sabe
-- checar). Estender o `case` quando deal/task/product/sale existirem —
-- nunca antes.
-- ------------------------------------------------------------

create or replace function public.entity_belongs_to_organization(
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  case p_entity_type
    when 'customer' then
      select exists(
        select 1 from public.clients
        where id = p_entity_id and organization_id = p_organization_id
      ) into v_found;
    when 'company' then
      select exists(
        select 1 from public.companies
        where id = p_entity_id and organization_id = p_organization_id
      ) into v_found;
    when 'contact' then
      select exists(
        select 1 from public.contacts
        where id = p_entity_id and organization_id = p_organization_id
      ) into v_found;
    else
      v_found := false;
  end case;
  return coalesce(v_found, false);
end;
$$;

grant execute on function public.entity_belongs_to_organization(text, uuid, uuid) to authenticated;

create or replace function public.validate_entity_tenant_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id) then
    raise exception 'entity_organization_mismatch: % % does not belong to organization %',
      new.entity_type, new.entity_id, new.organization_id;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- ENTITY_TAGS
-- ------------------------------------------------------------

create table public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'company', 'contact')),
  entity_id uuid not null,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  unique (entity_type, entity_id, tag_id)
);

create index entity_tags_org_entity_idx on public.entity_tags(organization_id, entity_type, entity_id);

create trigger entity_tags_validate_tenant_ownership
before insert or update of entity_type, entity_id, organization_id on public.entity_tags
for each row
execute function public.validate_entity_tenant_ownership();

-- tag_id também precisa pertencer à mesma organização — entity_belongs_to_organization
-- não cobre `tags` (não é uma entidade "tagueável", é o próprio rótulo).
create or replace function public.entity_tags_validate_tag_tenant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.tags
    where id = new.tag_id and organization_id = new.organization_id
  ) then
    raise exception 'entity_tag_tag_organization_mismatch';
  end if;
  return new;
end;
$$;

create trigger entity_tags_validate_tag_tenant
before insert or update of tag_id, organization_id on public.entity_tags
for each row
execute function public.entity_tags_validate_tag_tenant();

alter table public.entity_tags enable row level security;

create policy entity_tags_org_select
on public.entity_tags
for select
using (organization_id in (select public.current_user_org_ids()));

create policy entity_tags_org_write
on public.entity_tags
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.entity_tags to authenticated;

-- ------------------------------------------------------------
-- activities (timeline) — usada pelo trigger de "tag_added" abaixo.
-- Definida por completo em 202609180005; aqui só o log de tag_added,
-- adicionado depois que a tabela existir (ver migration 5).
-- ------------------------------------------------------------
