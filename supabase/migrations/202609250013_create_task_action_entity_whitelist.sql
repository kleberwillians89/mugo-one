begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Bug real achado no QA de loop: run_create_task_action herdava
-- entity_type do PRÓPRIO evento disparador por padrão. Para
-- lead.created isso é 'lead' (válido em tasks.entity_type). Mas para
-- task.created/task.completed/etc. o entity_type do evento é 'task' —
-- e tasks.entity_type (Sprint K/L) nunca permitiu 'task' nem
-- 'conversation' como valor (só customer/company/contact/lead/deal/
-- sale), então a inserção violava
-- tasks_entity_type_check. Corrigido: só herda entity_type do evento
-- quando ele está na mesma whitelist que tasks já aceita — senão a
-- task nasce sem relação nenhuma (sempre válido), nunca quebra.
-- ============================================================

create or replace function public.run_create_task_action(p_configuration jsonb, p_event public.domain_events)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_description text;
  v_entity_type text;
  v_entity_id uuid;
begin
  v_title := public.resolve_automation_template(coalesce(p_configuration->>'title', 'Tarefa automática'), p_event);
  v_description := case when p_configuration->>'description' is not null then public.resolve_automation_template(p_configuration->>'description', p_event) else null end;

  v_entity_type := p_configuration->>'entity_type';
  if v_entity_type is null and p_event.entity_type = any(array['customer','company','contact','lead','deal','sale']) then
    v_entity_type := p_event.entity_type;
  end if;
  v_entity_id := coalesce(nullif(p_configuration->>'entity_id', '')::uuid, case when v_entity_type = p_event.entity_type then p_event.entity_id else null end);

  return public.create_task(
    p_event.organization_id, v_title, v_description, coalesce(p_configuration->>'priority', 'normal'),
    nullif(p_configuration->>'assignee_user_id', '')::uuid, null, v_entity_type, v_entity_id,
    jsonb_build_object('automation_event_id', p_event.id), p_event.id
  );
end;
$$;

commit;
