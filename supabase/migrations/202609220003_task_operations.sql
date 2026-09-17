begin;

-- ============================================================
-- MUGÔ ONE — Sprint K/L (Task Engine Universal + Kanban)
--
-- Domain layer da task: 3 RPCs cobrem createTask/updateTask(detalhes)/
-- moveTask+completeTask+reopenTask+cancelTask(status)/assignTask —
-- consolidado por tipo de mudança, não uma RPC por verbo, para manter
-- Activity + tenant checks consistentes num lugar só por categoria de
-- operação (ver docs/TASK_ENGINE_MIGRATION_PLAN.md §Operações).
--
-- Concorrência otimista em todas: cada RPC recebe p_expected_updated_at
-- e recusa com 'task_stale' se a linha mudou desde que o chamador leu —
-- cenário explícito do briefing (usuário A move a task enquanto usuário
-- B edita o mesmo registro).
-- ============================================================

-- activities.entity_type precisa aceitar 'task' ANTES de qualquer RPC
-- abaixo chamar log_activity(..., 'task', ...) — mesmo bug encontrado
-- só no smoke test ao vivo da sprint anterior (Fase E/F), corrigido
-- aqui de forma proativa, na mesma migration que introduz o uso.
alter table public.activities drop constraint activities_entity_type_check;
alter table public.activities add constraint activities_entity_type_check
  check (entity_type = any (array['customer','company','contact','lead','deal','sale','catalog_item','task']::text[]));

-- ------------------------------------------------------------
-- create_task
-- ------------------------------------------------------------
create or replace function public.create_task(
  p_organization_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_assignee_user_id uuid default null,
  p_due_at timestamptz default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.has_org_permission(p_organization_id, 'tasks.create') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'task_title_required';
  end if;

  insert into public.tasks (
    organization_id, title, description, priority, assignee_user_id,
    due_at, entity_type, entity_id, created_by_user_id
  ) values (
    p_organization_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_priority, p_assignee_user_id,
    p_due_at, p_entity_type, p_entity_id, v_actor
  ) returning id into v_task_id;

  perform public.log_activity(
    p_organization_id, 'task', v_task_id, 'task_created', v_actor,
    'Tarefa criada', p_title,
    jsonb_build_object('priority', p_priority, 'assignee_user_id', p_assignee_user_id)
  );

  -- Se a task nasce ligada a uma entidade do Core, a timeline dessa
  -- entidade também recebe o evento — mesma activity, mesma linha
  -- (entity_type/entity_id já apontam para a task; o vínculo reverso
  -- para a timeline do customer/lead/deal/sale é feito na leitura, ver
  -- fetchEntityTaskActivity no frontend) — não duplicamos a linha em
  -- activities, evitando duas timelines concorrentes (briefing §16).

  return jsonb_build_object('task_id', v_task_id);
end;
$$;

-- ------------------------------------------------------------
-- update_task_details — título/descrição/prioridade/prazo/relação.
-- Sem activity própria: não está na lista de eventos relevantes do
-- briefing (§15) — só criação/atribuição/início/conclusão/reabertura/
-- cancelamento geram timeline.
-- ------------------------------------------------------------
create or replace function public.update_task_details(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_title text default null,
  p_description text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_clear_due_at boolean default false,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_clear_entity boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'task_not_found'; end if;
  if not public.has_org_permission(v_task.organization_id, 'tasks.edit') then
    raise exception 'forbidden';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'task_stale';
  end if;

  update public.tasks set
    title = coalesce(nullif(btrim(p_title), ''), title),
    description = case when p_description is not null then nullif(btrim(p_description), '') else description end,
    priority = coalesce(p_priority, priority),
    due_at = case when p_clear_due_at then null when p_due_at is not null then p_due_at else due_at end,
    entity_type = case when p_clear_entity then null when p_entity_type is not null then p_entity_type else entity_type end,
    entity_id = case when p_clear_entity then null when p_entity_id is not null then p_entity_id else entity_id end
  where id = p_task_id;

  return jsonb_build_object('task_id', p_task_id);
end;
$$;

-- ------------------------------------------------------------
-- update_task_status — cobre moveTask/completeTask/reopenTask/
-- cancelTask: todas são "mudar status (+ opcionalmente position)".
-- A activity certa é derivada da transição, nunca do verbo que o
-- frontend chamou — assim um drag-and-drop e um clique em "Concluir"
-- geram exatamente o mesmo rastro.
-- ------------------------------------------------------------
create or replace function public.update_task_status(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_new_status text,
  p_new_position integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_actor uuid := auth.uid();
  v_activity_type text;
begin
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'task_not_found'; end if;
  if not public.has_org_permission(v_task.organization_id, 'tasks.edit') then
    raise exception 'forbidden';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'task_stale';
  end if;
  if p_new_status not in ('todo', 'in_progress', 'waiting', 'done', 'cancelled') then
    raise exception 'task_invalid_status';
  end if;

  v_activity_type := case
    when v_task.status = p_new_status then null
    when p_new_status = 'done' then 'task_completed'
    when p_new_status = 'cancelled' then 'task_cancelled'
    when p_new_status = 'in_progress' and v_task.status not in ('done', 'cancelled') then 'task_started'
    when v_task.status in ('done', 'cancelled') and p_new_status in ('todo', 'in_progress', 'waiting') then 'task_reopened'
    else null
  end;

  update public.tasks set
    status = p_new_status,
    position = coalesce(p_new_position, position),
    started_at = case when p_new_status = 'in_progress' and started_at is null then now() else started_at end,
    completed_at = case when p_new_status = 'done' then now() when v_task.status = 'done' and p_new_status <> 'done' then null else completed_at end
  where id = p_task_id;

  if v_activity_type is not null then
    perform public.log_activity(
      v_task.organization_id, 'task', p_task_id, v_activity_type, v_actor,
      case v_activity_type
        when 'task_completed' then 'Tarefa concluída'
        when 'task_cancelled' then 'Tarefa cancelada'
        when 'task_started' then 'Tarefa iniciada'
        when 'task_reopened' then 'Tarefa reaberta'
        else v_activity_type
      end,
      v_task.title,
      jsonb_build_object('from_status', v_task.status, 'to_status', p_new_status)
    );
  end if;

  return jsonb_build_object('task_id', p_task_id, 'activity_logged', v_activity_type);
end;
$$;

-- ------------------------------------------------------------
-- assign_task
-- ------------------------------------------------------------
create or replace function public.assign_task(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_assignee_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_actor uuid := auth.uid();
begin
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'task_not_found'; end if;
  if not public.has_org_permission(v_task.organization_id, 'tasks.assign') then
    raise exception 'forbidden';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'task_stale';
  end if;
  if p_assignee_user_id is not null and not exists (
    select 1 from public.organization_members
    where organization_id = v_task.organization_id and user_id = p_assignee_user_id and status = 'active'
  ) then
    raise exception 'task_assignee_not_active_member';
  end if;

  update public.tasks set assignee_user_id = p_assignee_user_id where id = p_task_id;

  perform public.log_activity(
    v_task.organization_id, 'task', p_task_id, 'task_assigned', v_actor,
    'Tarefa atribuída', v_task.title,
    jsonb_build_object('from_assignee', v_task.assignee_user_id, 'to_assignee', p_assignee_user_id)
  );

  return jsonb_build_object('task_id', p_task_id);
end;
$$;

revoke execute on function public.create_task(uuid, text, text, text, uuid, timestamptz, text, uuid) from public, anon;
revoke execute on function public.update_task_details(uuid, timestamptz, text, text, text, timestamptz, boolean, text, uuid, boolean) from public, anon;
revoke execute on function public.update_task_status(uuid, timestamptz, text, integer) from public, anon;
revoke execute on function public.assign_task(uuid, timestamptz, uuid) from public, anon;

grant execute on function public.create_task(uuid, text, text, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.update_task_details(uuid, timestamptz, text, text, text, timestamptz, boolean, text, uuid, boolean) to authenticated;
grant execute on function public.update_task_status(uuid, timestamptz, text, integer) to authenticated;
grant execute on function public.assign_task(uuid, timestamptz, uuid) to authenticated;

commit;
