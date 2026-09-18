begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Bug real achado ao vivo: v_action declarada como "record" genérico
-- não pode ser passada para execute_automation_action(uuid,
-- automation_actions, domain_events) — Postgres não faz cast
-- implícito de record para um tipo composto nomeado numa CHAMADA de
-- função (funciona para acesso a campo, não como argumento
-- tipado). Corrigido declarando v_action com o tipo da tabela.
-- ============================================================

create or replace function public.evaluate_and_run_automations(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.domain_events;
  v_automation record;
  v_action public.automation_actions;
  v_run_id uuid;
  v_conditions_pass boolean;
  v_action_status text;
  v_any_failed boolean;
  v_any_succeeded boolean;
  v_run_status text;
begin
  select * into v_event from public.domain_events where id = p_event_id;
  if not found then return; end if;

  if v_event.causation_depth >= 10 then return; end if;

  for v_automation in
    select * from public.automations
    where organization_id = v_event.organization_id
      and status = 'active'
      and trigger_type = v_event.event_type
    order by created_at
  loop
    v_conditions_pass := public.evaluate_automation_conditions(v_automation.id, v_event);

    insert into public.automation_runs (organization_id, automation_id, event_id, automation_version, status, started_at)
    values (
      v_event.organization_id, v_automation.id, p_event_id, v_automation.version,
      case when v_conditions_pass then 'running' else 'skipped' end,
      case when v_conditions_pass then now() else null end
    )
    on conflict (automation_id, event_id, automation_version) do nothing
    returning id into v_run_id;

    if v_run_id is null then continue; end if;
    if not v_conditions_pass then
      update public.automation_runs set finished_at = now() where id = v_run_id;
      continue;
    end if;

    v_any_failed := false;
    v_any_succeeded := false;

    for v_action in select * from public.automation_actions where automation_id = v_automation.id and enabled order by position
    loop
      v_action_status := public.execute_automation_action(v_run_id, v_action, v_event);
      if v_action_status = 'completed' then
        v_any_succeeded := true;
      elsif v_action_status = 'failed' then
        v_any_failed := true;
        if v_automation.on_error = 'stop' then exit; end if;
      end if;
    end loop;

    v_run_status := case
      when v_any_failed and v_any_succeeded then 'partially_failed'
      when v_any_failed and not v_any_succeeded then 'failed'
      else 'completed'
    end;
    update public.automation_runs set status = v_run_status, finished_at = now() where id = v_run_id;
  end loop;
end;
$$;

commit;
