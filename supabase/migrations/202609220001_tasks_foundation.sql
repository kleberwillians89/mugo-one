begin;

-- ============================================================
-- MUGÔ ONE — Sprint K/L (Task Engine Universal + Kanban)
--
-- tasks: NÃO é uma generalização da Torre de Controle (que é um
-- dashboard de contagens agregadas, não tem registro de tarefa
-- individual — ver docs/TASK_ENGINE_MIGRATION_PLAN.md). É uma tabela
-- nova, do zero, com forma de tarefa de verdade.
--
-- entity_type/entity_id reaproveitam entity_belongs_to_organization()
-- (já validando customer/company/contact/lead/deal/sale desde as
-- sprints anteriores) — uma task pode se relacionar com qualquer uma
-- dessas seis, nunca uma tabela de relação por segmento.
-- ============================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  title text not null check (btrim(title) <> ''),
  description text,

  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),

  assignee_user_id uuid references auth.users(id) on delete set null,
  created_by_user_id uuid references public.profiles(id),

  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,

  -- Nullable: uma task pode não estar ligada a nada (lembrete solto).
  -- Quando presente, o par precisa ser válido junto — nunca um sozinho.
  entity_type text check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal', 'sale')),
  entity_id uuid,
  check ((entity_type is null) = (entity_id is null)),

  -- Gaps numéricos (1000, 2000, 3000...) em vez de posição sequencial
  -- 1,2,3 — mover uma task entre duas outras vira UM update (posição =
  -- ponto médio dos vizinhos), nunca reindexar a coluna inteira. Ver
  -- docs/TASK_ENGINE_MIGRATION_PLAN.md §Position para o racional.
  position integer not null default 1000,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (id, organization_id)
);

create index tasks_org_status_position_idx
  on public.tasks(organization_id, status, position)
  where deleted_at is null;
create index tasks_org_assignee_idx
  on public.tasks(organization_id, assignee_user_id)
  where deleted_at is null and assignee_user_id is not null;
create index tasks_org_entity_idx
  on public.tasks(organization_id, entity_type, entity_id)
  where deleted_at is null and entity_type is not null;
create index tasks_org_due_idx
  on public.tasks(organization_id, due_at)
  where deleted_at is null and due_at is not null and status not in ('done', 'cancelled');

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.crm_set_updated_at();

create trigger tasks_prevent_organization_change
before update of organization_id on public.tasks
for each row execute function public.crm_prevent_organization_change();

-- Tenant-safety da relação com outra entidade (customer/company/.../sale)
-- E do assignee (precisa ser membro ativo da MESMA organização —
-- cross-org proibido, membro inativo não pode RECEBER task nova, mas
-- uma task histórica pode continuar apontando para ele: por isso a
-- checagem roda só quando assignee_user_id muda, não em todo update).
create or replace function public.tasks_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entity_type is not null and not public.entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id) then
    raise exception 'task_entity_organization_mismatch';
  end if;

  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
      select 1 from public.organization_members
      where organization_id = new.organization_id
        and user_id = new.assignee_user_id
        and status = 'active'
    ) then
      raise exception 'task_assignee_not_active_member';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_validate_tenant_refs
before insert or update
on public.tasks
for each row execute function public.tasks_validate_tenant_refs();

alter table public.tasks enable row level security;

-- viewer: só leitura, controlado por has_org_permission('tasks.view')
-- (view_all concede tudo que termina em .view automaticamente — ver
-- has_org_permission). admin/access_total: funciona por construção,
-- has_org_permission já retorna true antes de qualquer outra checagem.
create policy tasks_org_select on public.tasks for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'tasks.view')
);
create policy tasks_org_insert on public.tasks for insert
with check (public.has_org_permission(organization_id, 'tasks.create'));
create policy tasks_org_update on public.tasks for update
using (public.has_org_permission(organization_id, 'tasks.edit'))
with check (public.has_org_permission(organization_id, 'tasks.edit'));
create policy tasks_org_delete on public.tasks for delete
using (public.has_org_permission(organization_id, 'tasks.manage'));

grant select, insert, update, delete on public.tasks to authenticated;

revoke execute on function public.tasks_validate_tenant_refs() from public, anon, authenticated;

-- entity_belongs_to_organization ganha o case 'task' — aditivo, nenhum
-- case existente é alterado. Necessário para tags/custom fields em task
-- (migration separada, ver §7 do briefing: "somente task, sem big-bang")
-- e para qualquer futuro log_activity(..., 'task', ...) vindo de outro
-- lugar que não seja diretamente as RPCs desta sprint.
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
    when 'task' then
      select exists(select 1 from public.tasks where id = p_entity_id and organization_id = p_organization_id and deleted_at is null)
        into v_found;
    else
      v_found := false;
  end case;
  return coalesce(v_found, false);
end;
$$;

commit;
