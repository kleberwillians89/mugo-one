begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Sem permissão por action (briefing §40 — nunca
-- automations.send_email/automations.create_task). Feature nova
-- 'automations', is_core=false — nasce desativada, mesmo padrão de
-- 'communications'/'lead_intake' quando foram introduzidas.
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('automations.view', 'automations', 'Visualizar automações', 190),
  ('automations.create', 'automations', 'Criar automações', 191),
  ('automations.edit', 'automations', 'Editar automações', 192),
  ('automations.manage', 'automations', 'Ativar, pausar e arquivar automações', 193)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('gestor', 'automations.view'),
  ('gestor', 'automations.create'),
  ('gestor', 'automations.edit'),
  ('gestor', 'automations.manage')
on conflict do nothing;

insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'automations.%'
  and om.permission_preset = 'gestor'
on conflict (organization_id, user_id, permission_code) do nothing;

insert into public.features (code, label, description, is_core) values
  ('automations', 'Automações', 'Transforma eventos do CRM em ações automáticas (criar tarefa, enviar e-mail).', false)
on conflict (code) do nothing;

commit;
