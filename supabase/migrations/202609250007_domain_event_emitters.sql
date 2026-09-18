begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Liga emit_domain_event às RPCs de domínio já existentes — CADA UMA
-- delas é a ÚNICA fonte responsável pelo seu evento (briefing §8),
-- emissão na MESMA transação da mudança (briefing §7). Nenhuma lógica
-- nova de negócio é adicionada aqui, só as chamadas de emissão.
--
-- causation_id: create_task/send_communication_message ganham
-- p_causation_id (novo parâmetro final, default null — chamadas
-- normais do produto continuam raiz/depth=0). Quando uma automação
-- chama essas RPCs via run_create_task_action/run_send_email_action,
-- passa o id do evento que a disparou, encadeando a profundidade
-- (briefing §9/§24).
-- ============================================================

create or replace function public.create_task(
  p_organization_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_assignee_user_id uuid default null,
  p_due_at timestamptz default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_causation_id uuid default null
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
  if auth.role() <> 'service_role' and not public.has_org_permission(p_organization_id, 'tasks.create') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'task_title_required';
  end if;

  insert into public.tasks (
    organization_id, title, description, priority, assignee_user_id,
    due_at, entity_type, entity_id, created_by_user_id, metadata
  ) values (
    p_organization_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_priority, p_assignee_user_id,
    p_due_at, p_entity_type, p_entity_id, v_actor, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_task_id;

  perform public.log_activity(
    p_organization_id, 'task', v_task_id, 'task_created', v_actor,
    'Tarefa criada', p_title,
    jsonb_build_object('priority', p_priority, 'assignee_user_id', p_assignee_user_id)
  );

  perform public.emit_domain_event(
    p_organization_id, 'task.created', 'task', v_task_id,
    jsonb_build_object('task_id', v_task_id, 'title', p_title, 'priority', p_priority, 'entity_type', p_entity_type, 'entity_id', p_entity_id, 'assignee_user_id', p_assignee_user_id),
    'create_task', v_actor, null, p_causation_id
  );

  return jsonb_build_object('task_id', v_task_id);
end;
$$;

create or replace function public.update_task_status(p_task_id uuid, p_expected_updated_at timestamptz, p_new_status text, p_new_position integer default null)
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

    perform public.emit_domain_event(
      v_task.organization_id,
      case v_activity_type
        when 'task_completed' then 'task.completed'
        when 'task_cancelled' then 'task.cancelled'
        when 'task_started' then 'task.started'
        when 'task_reopened' then 'task.reopened'
      end,
      'task', p_task_id,
      jsonb_build_object('task_id', p_task_id, 'from_status', v_task.status, 'to_status', p_new_status),
      'update_task_status', v_actor, null, null
    );
  end if;

  return jsonb_build_object('task_id', p_task_id, 'activity_logged', v_activity_type);
end;
$$;

create or replace function public.assign_task(p_task_id uuid, p_expected_updated_at timestamptz, p_assignee_user_id uuid)
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

  perform public.emit_domain_event(
    v_task.organization_id, 'task.assigned', 'task', p_task_id,
    jsonb_build_object('task_id', p_task_id, 'from_assignee', v_task.assignee_user_id, 'to_assignee', p_assignee_user_id),
    'assign_task', v_actor, null, null
  );

  return jsonb_build_object('task_id', p_task_id);
end;
$$;

commit;
