begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- Bug real achado no QA: set_automation_actions (Sprint O) tem sua
-- PRÓPRIA whitelist de action_type hardcoded, independente do CHECK
-- da tabela — ao adicionar issue_fiscal_document ao CHECK
-- (migration 202609260008), esqueci desta segunda whitelist na RPC de
-- validação, que rejeitava a nova action antes mesmo de chegar no
-- INSERT. Corrigido; as duas listas agora concordam.
-- ============================================================

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
    if not (v_action->>'action_type' = any(array['create_task','send_email','issue_fiscal_document'])) then
      raise exception 'invalid_action_type';
    end if;
    insert into public.automation_actions (automation_id, action_type, configuration, position, enabled)
    values (p_automation_id, v_action->>'action_type', coalesce(v_action->'configuration', '{}'::jsonb), coalesce((v_action->>'position')::int, 0), coalesce((v_action->>'enabled')::boolean, true));
  end loop;
end;
$$;

commit;
