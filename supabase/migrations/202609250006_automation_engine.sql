begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Motor de execução. Roda SÍNCRONO dentro de emit_domain_event (sem
-- pg_cron/pg_net neste projeto — ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md
-- §5). MAX_AUTOMATION_DEPTH=10 (briefing §24) corta qualquer cadeia
-- causation_id→causation_id antes de virar loop.
-- ============================================================

create or replace function public.resolve_automation_field(p_field_path text, p_event public.domain_events)
returns jsonb
language plpgsql
stable
as $$
declare
  v_parts text[];
begin
  if p_field_path = 'event.type' then return to_jsonb(p_event.event_type); end if;
  if p_field_path = 'entity.type' then return to_jsonb(p_event.entity_type); end if;
  if p_field_path = 'entity.id' then return to_jsonb(p_event.entity_id); end if;
  if p_field_path like 'event.payload.%' then
    v_parts := string_to_array(substring(p_field_path from 15), '.');
    return p_event.payload #> v_parts;
  end if;
  -- Whitelist explícito (briefing §14) — qualquer path fora desta
  -- lista devolve NULL, nunca executa SQL dinâmico.
  return null;
end;
$$;

create or replace function public.evaluate_condition_operator(p_actual jsonb, p_operator text, p_expected jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_actual_text text := p_actual #>> '{}';
  v_expected_text text := p_expected #>> '{}';
  v_actual_num numeric;
  v_expected_num numeric;
begin
  case p_operator
    when 'equals' then return coalesce(v_actual_text = v_expected_text, false);
    when 'not_equals' then return coalesce(v_actual_text is distinct from v_expected_text, true);
    when 'contains' then return v_actual_text is not null and v_expected_text is not null and position(lower(v_expected_text) in lower(v_actual_text)) > 0;
    when 'not_contains' then return not (v_actual_text is not null and v_expected_text is not null and position(lower(v_expected_text) in lower(v_actual_text)) > 0);
    when 'is_empty' then return v_actual_text is null or v_actual_text = '';
    when 'is_not_empty' then return v_actual_text is not null and v_actual_text <> '';
    when 'greater_than' then
      begin
        return v_actual_text::numeric > v_expected_text::numeric;
      exception when others then return false;
      end;
    when 'less_than' then
      begin
        return v_actual_text::numeric < v_expected_text::numeric;
      exception when others then return false;
      end;
    when 'in' then
      return exists (select 1 from jsonb_array_elements_text(coalesce(p_expected, '[]'::jsonb)) as elem where elem = v_actual_text);
    when 'not_in' then
      return not exists (select 1 from jsonb_array_elements_text(coalesce(p_expected, '[]'::jsonb)) as elem where elem = v_actual_text);
    else return false;
  end case;
end;
$$;

create or replace function public.evaluate_automation_conditions(p_automation_id uuid, p_event public.domain_events)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_condition record;
begin
  for v_condition in select * from public.automation_conditions where automation_id = p_automation_id order by position
  loop
    if not public.evaluate_condition_operator(public.resolve_automation_field(v_condition.field_path, p_event), v_condition.operator, v_condition.value) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Variáveis de template — subconjunto seguro (briefing §37). Variável
-- desconhecida permanece como texto literal ({{algo}}) em vez de
-- quebrar ou sumir silenciosamente — visível para quem está montando
-- a automação.
create or replace function public.resolve_automation_template(p_template text, p_event public.domain_events)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result text := coalesce(p_template, '');
  v_lead_name text; v_lead_email text; v_customer_name text; v_company_name text; v_deal_name text; v_task_title text;
begin
  if p_event.entity_type = 'lead' then
    select name, email into v_lead_name, v_lead_email from public.leads where id = p_event.entity_id;
  end if;
  if v_lead_name is null and p_event.payload ? 'name' then v_lead_name := p_event.payload->>'name'; end if;

  if p_event.entity_type = 'customer' then
    select name into v_customer_name from public.clients where id = p_event.entity_id;
  elsif p_event.payload ? 'customer_id' and p_event.payload->>'customer_id' is not null then
    select name into v_customer_name from public.clients where id = (p_event.payload->>'customer_id')::uuid;
  end if;

  if p_event.entity_type = 'company' then
    select name into v_company_name from public.companies where id = p_event.entity_id;
  end if;
  if p_event.entity_type = 'deal' then
    select title into v_deal_name from public.deals where id = p_event.entity_id;
  end if;
  if p_event.entity_type = 'task' then
    select title into v_task_title from public.tasks where id = p_event.entity_id;
  end if;

  v_result := replace(v_result, '{{lead.name}}', coalesce(v_lead_name, ''));
  v_result := replace(v_result, '{{lead.email}}', coalesce(v_lead_email, ''));
  v_result := replace(v_result, '{{customer.name}}', coalesce(v_customer_name, ''));
  v_result := replace(v_result, '{{company.name}}', coalesce(v_company_name, ''));
  v_result := replace(v_result, '{{deal.name}}', coalesce(v_deal_name, ''));
  v_result := replace(v_result, '{{task.title}}', coalesce(v_task_title, ''));
  return v_result;
end;
$$;

-- ============================================================
-- Executores de action (briefing §16/§17/§18 — reaproveitam a mesma
-- RPC de domínio usada pelo resto do produto, nunca reimplementam o
-- insert). create_task/send_communication_message já aceitam
-- auth.role()='service_role' como caminho alternativo ao
-- has_org_permission (mesma convenção da Sprint N) — necessário
-- porque uma automação disparada por um webhook público (ex.:
-- lead-intake) não tem usuário autenticado nenhum. Quando o evento
-- nasce de uma ação de usuário autenticado, a action roda com a
-- permissão DESSE usuário — ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md
-- (nota sobre execution context, briefing §68: uma identidade de
-- serviço dedicada fica para uma sprint futura).
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
  v_entity_type := coalesce(p_configuration->>'entity_type', p_event.entity_type);
  v_entity_id := coalesce(nullif(p_configuration->>'entity_id', '')::uuid, p_event.entity_id);

  return public.create_task(
    p_event.organization_id, v_title, v_description, coalesce(p_configuration->>'priority', 'normal'),
    nullif(p_configuration->>'assignee_user_id', '')::uuid, null, v_entity_type, v_entity_id,
    jsonb_build_object('automation_event_id', p_event.id)
  );
end;
$$;

create or replace function public.run_send_email_action(p_configuration jsonb, p_event public.domain_events)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  v_customer_id uuid;
  v_lead_id uuid;
begin
  v_subject := public.resolve_automation_template(coalesce(p_configuration->>'subject', 'Mensagem automática'), p_event);
  v_body := public.resolve_automation_template(coalesce(p_configuration->>'body_text', ''), p_event);

  if p_event.entity_type = 'lead' then v_lead_id := p_event.entity_id;
  elsif p_event.entity_type = 'customer' then v_customer_id := p_event.entity_id;
  elsif p_event.payload ? 'customer_id' then v_customer_id := nullif(p_event.payload->>'customer_id', '')::uuid;
  end if;

  return public.send_communication_message(
    p_event.organization_id, 'email', null, v_customer_id, null, null, v_lead_id, null,
    nullif(p_configuration->>'recipient_identity', ''), v_subject, v_body, 'resend'
  );
end;
$$;

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
    else
      v_status := 'skipped';
    end if;
  exception when others then
    v_status := 'failed';
    v_error_code := sqlstate;
    -- sanitizado: mensagem do Postgres, nunca body de e-mail/PII
    -- (briefing §75) — sqlerrm de uma RPC de domínio já é curto/técnico.
    v_error_message := left(sqlerrm, 300);
  end;

  update public.automation_action_runs set
    status = v_status, output_snapshot = coalesce(v_output, '{}'::jsonb),
    error_code = v_error_code, error_message = v_error_message, finished_at = now()
  where id = v_action_run_id;

  return v_status;
end;
$$;

-- ============================================================
-- evaluate_and_run_automations: chamada só de dentro de
-- emit_domain_event (nunca exposta diretamente).
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
  v_action record;
  v_run_id uuid;
  v_conditions_pass boolean;
  v_action_status text;
  v_any_failed boolean;
  v_any_succeeded boolean;
  v_run_status text;
begin
  select * into v_event from public.domain_events where id = p_event_id;
  if not found then return; end if;

  -- Prevenção de loop (briefing §24/§25): eventos causados por uma
  -- cadeia de automação profunda demais não disparam NADA de novo.
  if v_event.causation_depth >= 10 then return; end if;

  for v_automation in
    select * from public.automations
    where organization_id = v_event.organization_id
      and status = 'active'
      and trigger_type = v_event.event_type
    order by created_at
  loop
    v_conditions_pass := public.evaluate_automation_conditions(v_automation.id, v_event);

    -- Idempotência (briefing §23): unique(automation_id,event_id,version)
    -- — reprocessar o mesmo evento nunca cria um segundo run.
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

    -- Cada action bem-sucedida desta automação vira a "causa" dos
    -- eventos que ela própria emitir (create_task já emite task.created
    -- via seu próprio emissor, ver migration seguinte) — o
    -- causation_id encadeia através de v_event.id, nunca do run.
  end loop;
end;
$$;

revoke all on function public.evaluate_and_run_automations(uuid) from public, anon, authenticated;
revoke all on function public.execute_automation_action(uuid, public.automation_actions, public.domain_events) from public, anon, authenticated;
revoke all on function public.run_create_task_action(jsonb, public.domain_events) from public, anon, authenticated;
revoke all on function public.run_send_email_action(jsonb, public.domain_events) from public, anon, authenticated;

commit;
