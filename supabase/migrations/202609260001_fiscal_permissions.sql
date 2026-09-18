begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- Feature 'fiscal' já existe (seedada especulativamente numa sprint
-- anterior, is_core=false) — não recriada. Sem permissão por tipo de
-- documento (briefing §29).
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('fiscal.view', 'fiscal', 'Visualizar documentos fiscais', 200),
  ('fiscal.issue', 'fiscal', 'Emitir documentos fiscais', 201),
  ('fiscal.cancel', 'fiscal', 'Cancelar documentos fiscais', 202),
  ('fiscal.manage', 'fiscal', 'Configurar perfil e conexão fiscal', 203)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('gestor', 'fiscal.view'),
  ('gestor', 'fiscal.issue'),
  ('gestor', 'fiscal.cancel'),
  ('gestor', 'fiscal.manage')
on conflict do nothing;

insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'fiscal.%'
  and om.permission_preset = 'gestor'
on conflict (organization_id, user_id, permission_code) do nothing;

commit;
