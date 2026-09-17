begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- has_org_permission() checa organization_member_permissions
-- (materializado), não preset_permissions diretamente. Membros
-- 'gestor'/'comercial' já existentes (provisionados ANTES desta
-- sprint) precisam de uma linha explícita aqui para receberem
-- lead_intake.view/manage sem precisar sair e entrar de novo — mesmo
-- padrão já usado em 202609190001 (crm.*) quando 'gestor'/'comercial'
-- ganharam permissões novas depois do insert original de presets.
-- ============================================================

insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'lead_intake.%'
  and om.permission_preset in ('gestor', 'comercial')
on conflict (organization_id, user_id, permission_code) do nothing;

commit;
