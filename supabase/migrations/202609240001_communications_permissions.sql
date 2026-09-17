begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- Feature 'communications' JÁ EXISTE desde 202609170001 (Fase A-D),
-- is_core=false, label "Comunicação" — não recriada, só passa a ter
-- conteúdo de verdade por trás dela nesta sprint (ver
-- docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §1).
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('communications.view', 'communications', 'Visualizar conversas', 180),
  ('communications.send', 'communications', 'Enviar mensagens', 181),
  ('communications.assign', 'communications', 'Atribuir conversas', 182),
  ('communications.manage', 'communications', 'Gerenciar conexões de comunicação', 183)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('gestor', 'communications.view'),
  ('gestor', 'communications.send'),
  ('gestor', 'communications.assign'),
  ('gestor', 'communications.manage'),
  ('comercial', 'communications.view'),
  ('comercial', 'communications.send'),
  ('comercial', 'communications.assign')
on conflict do nothing;

-- Backfill para membros 'gestor'/'comercial' já existentes — mesmo
-- padrão de 202609190001/202609230007 (has_org_permission checa
-- organization_member_permissions materializado, não preset_permissions
-- diretamente).
insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'communications.%'
  and om.permission_preset in ('gestor', 'comercial')
on conflict (organization_id, user_id, permission_code) do nothing;

commit;
