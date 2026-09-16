-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- NOTES + ACTIVITIES (timeline foundation)
--
-- Reaproveita entity_belongs_to_organization()/validate_entity_tenant_ownership()
-- de 202609180003_crm_tags.sql. Só os eventos "seguros" desta sprint são
-- integrados via trigger: customer_created, company_created,
-- contact_created, note_added, tag_added — ver docs/CRM_DOMAIN_MODEL.md.
-- ============================================================

-- ------------------------------------------------------------
-- NOTES
-- ------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'company', 'contact')),
  entity_id uuid not null,
  author_user_id uuid references auth.users(id) on delete set null,
  content text not null check (btrim(content) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notes_org_entity_idx on public.notes(organization_id, entity_type, entity_id);

create or replace function public.notes_set_updated_at()
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

create trigger notes_set_updated_at
before update on public.notes
for each row
execute function public.notes_set_updated_at();

create trigger notes_validate_tenant_ownership
before insert or update of entity_type, entity_id, organization_id on public.notes
for each row
execute function public.validate_entity_tenant_ownership();

alter table public.notes enable row level security;

create policy notes_org_select
on public.notes
for select
using (organization_id in (select public.current_user_org_ids()));

create policy notes_org_write
on public.notes
for all
using (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]))
with check (public.has_org_role(organization_id, array['admin','manager','operator']::public.member_role[]));

grant select, insert, update, delete on public.notes to authenticated;

-- ------------------------------------------------------------
-- ACTIVITIES
-- Só leitura direta para authenticated — toda escrita passa por
-- log_activity() (security definer), nunca por INSERT direto do
-- cliente. Mesmo desenho de audit_logs no core (feat/core-foundation):
-- ninguém grava a própria linha de timeline "à mão".
-- ------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'company', 'contact')),
  entity_id uuid not null,
  activity_type text not null check (btrim(activity_type) <> ''),
  actor_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activities_org_entity_idx on public.activities(organization_id, entity_type, entity_id, created_at desc);

alter table public.activities enable row level security;

create policy activities_org_select
on public.activities
for select
using (organization_id in (select public.current_user_org_ids()));

grant select on public.activities to authenticated;

-- log_activity() é o único caminho de escrita em activities. security
-- definer para não depender de grant de INSERT ao papel authenticated —
-- só é chamada pelos triggers abaixo (customer_created, company_created,
-- contact_created, note_added, tag_added), nunca diretamente pelo
-- frontend.
create or replace function public.log_activity(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_activity_type text,
  p_actor_user_id uuid,
  p_title text,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.entity_belongs_to_organization(p_entity_type, p_entity_id, p_organization_id) then
    raise exception 'entity_organization_mismatch: % % does not belong to organization %',
      p_entity_type, p_entity_id, p_organization_id;
  end if;

  insert into public.activities (
    organization_id, entity_type, entity_id, activity_type,
    actor_user_id, title, description, metadata
  )
  values (
    p_organization_id, p_entity_type, p_entity_id, p_activity_type,
    p_actor_user_id, p_title, p_description, p_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- Eventos seguros integrados nesta sprint
-- ------------------------------------------------------------

create or replace function public.clients_log_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.log_activity(
    new.organization_id, 'customer', new.id, 'customer_created',
    new.created_by, new.name
  );
  return new;
end;
$$;

create trigger clients_log_activity
after insert on public.clients
for each row
execute function public.clients_log_activity();

create or replace function public.companies_log_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.log_activity(
    new.organization_id, 'company', new.id, 'company_created',
    new.created_by, new.name
  );
  return new;
end;
$$;

create trigger companies_log_activity
after insert on public.companies
for each row
execute function public.companies_log_activity();

create or replace function public.contacts_log_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.log_activity(
    new.organization_id, 'contact', new.id, 'contact_created',
    new.created_by, new.name
  );
  return new;
end;
$$;

create trigger contacts_log_activity
after insert on public.contacts
for each row
execute function public.contacts_log_activity();

create or replace function public.notes_log_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.log_activity(
    new.organization_id, new.entity_type, new.entity_id, 'note_added',
    new.author_user_id, 'Nota adicionada',
    left(new.content, 140)
  );
  return new;
end;
$$;

create trigger notes_log_activity
after insert on public.notes
for each row
execute function public.notes_log_activity();

create or replace function public.entity_tags_log_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tag_name text;
begin
  select name into v_tag_name from public.tags where id = new.tag_id;
  perform public.log_activity(
    new.organization_id, new.entity_type, new.entity_id, 'tag_added',
    new.created_by, coalesce('Tag adicionada: ' || v_tag_name, 'Tag adicionada')
  );
  return new;
end;
$$;

create trigger entity_tags_log_activity
after insert on public.entity_tags
for each row
execute function public.entity_tags_log_activity();
