begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- CRUD de automations. Decisão de ativação (briefing §38): ativar uma
-- automation com action send_email SEM connection/provider configurado
-- é PERMITIDO — a falha aparece na EXECUÇÃO (action fica
-- 'failed'/provider_not_configured, run 'partially_failed'), nunca
-- bloqueando a ativação. Isso é coerente com o briefing §19 ("a
-- automação não some" quando RESEND_API_KEY está ausente) e evita um
-- segundo lugar (ativação) reimplementando a mesma validação que já
-- acontece de forma visível na execução.
-- ============================================================

create or replace function public.create_automation(
  p_organization_id uuid,
  p_name text,
  p_trigger_type text,
  p_description text default null,
  p_on_error text default 'continue'
)
returns public.automations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automations;
begin
  if not public.has_org_permission(p_organization_id, 'automations.create') then
    raise exception 'forbidden';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'automation_name_required'; end if;
  if btrim(coalesce(p_trigger_type, '')) = '' then raise exception 'automation_trigger_required'; end if;
  if p_on_error not in ('continue', 'stop') then raise exception 'invalid_on_error'; end if;

  insert into public.automations (organization_id, name, description, trigger_type, on_error, created_by)
  values (p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), btrim(p_trigger_type), p_on_error, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_automation(
  p_automation_id uuid,
  p_name text,
  p_trigger_type text,
  p_description text default null,
  p_on_error text default 'continue'
)
returns public.automations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automations;
begin
  select * into v_row from public.automations where id = p_automation_id;
  if not found then raise exception 'automation_not_found'; end if;
  if not public.has_org_permission(v_row.organization_id, 'automations.edit') then
    raise exception 'forbidden';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'automation_name_required'; end if;
  if btrim(coalesce(p_trigger_type, '')) = '' then raise exception 'automation_trigger_required'; end if;
  if p_on_error not in ('continue', 'stop') then raise exception 'invalid_on_error'; end if;

  update public.automations set
    name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
    trigger_type = btrim(p_trigger_type), on_error = p_on_error,
    -- Automação ATIVA alterada ganha nova versão — runs antigos
    -- continuam ligados à versão que de fato executaram (briefing §70).
    version = case when v_row.status = 'active' then v_row.version + 1 else v_row.version end
  where id = p_automation_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_automation_conditions(p_automation_id uuid, p_conditions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automations;
  v_condition jsonb;
begin
  select * into v_row from public.automations where id = p_automation_id;
  if not found then raise exception 'automation_not_found'; end if;
  if not public.has_org_permission(v_row.organization_id, 'automations.edit') then
    raise exception 'forbidden';
  end if;

  delete from public.automation_conditions where automation_id = p_automation_id;

  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    if not (v_condition->>'operator' = any(array['equals','not_equals','contains','not_contains','is_empty','is_not_empty','greater_than','less_than','in','not_in'])) then
      raise exception 'invalid_condition_operator';
    end if;
    insert into public.automation_conditions (automation_id, field_path, operator, value, position)
    values (p_automation_id, v_condition->>'field_path', v_condition->>'operator', v_condition->'value', coalesce((v_condition->>'position')::int, 0));
  end loop;
end;
$$;

create or replace function public.set_automation_actions(p_automation_id uuid, p_actions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automations;
  v_action jsonb;
begin
  select * into v_row from public.automations where id = p_automation_id;
  if not found then raise exception 'automation_not_found'; end if;
  if not public.has_org_permission(v_row.organization_id, 'automations.edit') then
    raise exception 'forbidden';
  end if;
  if jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) = 0 then
    raise exception 'automation_requires_at_least_one_action';
  end if;

  delete from public.automation_actions where automation_id = p_automation_id;

  for v_action in select * from jsonb_array_elements(p_actions)
  loop
    if not (v_action->>'action_type' = any(array['create_task','send_email'])) then
      raise exception 'invalid_action_type';
    end if;
    insert into public.automation_actions (automation_id, action_type, configuration, position, enabled)
    values (p_automation_id, v_action->>'action_type', coalesce(v_action->'configuration', '{}'::jsonb), coalesce((v_action->>'position')::int, 0), coalesce((v_action->>'enabled')::boolean, true));
  end loop;
end;
$$;

create or replace function public.set_automation_status(p_automation_id uuid, p_new_status text)
returns public.automations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automations;
  v_actor uuid := auth.uid();
begin
  if p_new_status not in ('draft', 'active', 'paused', 'archived') then raise exception 'invalid_status'; end if;
  select * into v_row from public.automations where id = p_automation_id;
  if not found then raise exception 'automation_not_found'; end if;
  if not public.has_org_permission(v_row.organization_id, 'automations.manage') then
    raise exception 'forbidden';
  end if;

  if p_new_status = 'active' and not exists (select 1 from public.automation_actions where automation_id = p_automation_id and enabled) then
    raise exception 'automation_requires_at_least_one_action';
  end if;

  update public.automations set
    status = p_new_status,
    enabled_by = case when p_new_status = 'active' then v_actor else enabled_by end,
    enabled_at = case when p_new_status = 'active' then now() else enabled_at end,
    disabled_at = case when p_new_status in ('paused', 'archived') then now() else disabled_at end
  where id = p_automation_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.duplicate_automation(p_automation_id uuid)
returns public.automations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.automations;
  v_new public.automations;
begin
  select * into v_source from public.automations where id = p_automation_id;
  if not found then raise exception 'automation_not_found'; end if;
  if not public.has_org_permission(v_source.organization_id, 'automations.create') then
    raise exception 'forbidden';
  end if;

  insert into public.automations (organization_id, name, description, trigger_type, on_error, created_by)
  values (v_source.organization_id, v_source.name || ' (cópia)', v_source.description, v_source.trigger_type, v_source.on_error, auth.uid())
  returning * into v_new;

  insert into public.automation_conditions (automation_id, field_path, operator, value, position)
  select v_new.id, field_path, operator, value, position from public.automation_conditions where automation_id = p_automation_id;

  insert into public.automation_actions (automation_id, action_type, configuration, position, enabled)
  select v_new.id, action_type, configuration, position, enabled from public.automation_actions where automation_id = p_automation_id;

  return v_new;
end;
$$;

revoke all on function public.create_automation(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_automation(uuid, text, text, text, text) to authenticated;
revoke all on function public.update_automation(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_automation(uuid, text, text, text, text) to authenticated;
revoke all on function public.set_automation_conditions(uuid, jsonb) from public, anon;
grant execute on function public.set_automation_conditions(uuid, jsonb) to authenticated;
revoke all on function public.set_automation_actions(uuid, jsonb) from public, anon;
grant execute on function public.set_automation_actions(uuid, jsonb) to authenticated;
revoke all on function public.set_automation_status(uuid, text) from public, anon;
grant execute on function public.set_automation_status(uuid, text) to authenticated;
revoke all on function public.duplicate_automation(uuid) from public, anon;
grant execute on function public.duplicate_automation(uuid) to authenticated;

commit;
