begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- issue_fiscal_document entra no catálogo de actions do Automation
-- Engine (Sprint O) — nunca chama a Nuvem Fiscal diretamente, chama a
-- MESMA request_fiscal_document usada pela emissão manual (briefing
-- §26). Revalida tudo dentro da execução, nunca confia só no payload
-- do evento (briefing §70).
-- ============================================================

alter table public.automation_actions drop constraint if exists automation_actions_action_type_check;
alter table public.automation_actions add constraint automation_actions_action_type_check
  check (action_type in ('create_task', 'send_email', 'issue_fiscal_document'));

create or replace function public.run_issue_fiscal_document_action(p_configuration jsonb, p_event public.domain_events)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_document_type text := coalesce(p_configuration->>'document_type', 'nfse');
begin
  if p_event.entity_type = 'sale' then v_sale_id := p_event.entity_id;
  elsif p_event.payload ? 'sale_id' then v_sale_id := nullif(p_event.payload->>'sale_id', '')::uuid;
  end if;
  if v_sale_id is null then
    raise exception 'MISSING_RECIPIENT_DOCUMENT';
  end if;

  return public.request_fiscal_document(p_event.organization_id, v_sale_id, v_document_type, p_event.id);
end;
$$;

revoke all on function public.run_issue_fiscal_document_action(jsonb, public.domain_events) from public, anon, authenticated;

-- ============================================================
-- execute_automation_action ganha o novo ramo (mesmo corpo da Sprint
-- O, só acrescentando issue_fiscal_document).
-- ============================================================

create or replace function public.execute_automation_action(p_run_id uuid, p_action public.automation_actions, p_event public.domain_events)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_run_id uuid;
  v_status text := 'failed';
  v_error_code text;
  v_error_message text;
  v_output jsonb := '{}'::jsonb;
begin
  insert into public.automation_action_runs (organization_id, automation_run_id, automation_action_id, status, input_snapshot, started_at)
  values (p_event.organization_id, p_run_id, p_action.id, 'running', p_action.configuration, now())
  returning id into v_action_run_id;

  begin
    if p_action.action_type = 'create_task' then
      v_output := public.run_create_task_action(p_action.configuration, p_event);
      v_status := 'completed';
    elsif p_action.action_type = 'send_email' then
      v_output := public.run_send_email_action(p_action.configuration, p_event);
      v_status := 'completed';
    elsif p_action.action_type = 'issue_fiscal_document' then
      v_output := public.run_issue_fiscal_document_action(p_action.configuration, p_event);
      v_status := 'completed';
    else
      v_status := 'skipped';
    end if;
  exception when others then
    v_status := 'failed';
    v_error_code := sqlstate;
    v_error_message := left(sqlerrm, 300);
  end;

  update public.automation_action_runs set
    status = v_status, output_snapshot = coalesce(v_output, '{}'::jsonb),
    error_code = v_error_code, error_message = v_error_message, finished_at = now()
  where id = v_action_run_id;

  return v_status;
end;
$$;

commit;
