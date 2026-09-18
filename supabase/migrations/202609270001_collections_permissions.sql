begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- Cobranças já usa sales.view/sales.edit para a fila e o registro de
-- pagamento (collections_pending_sales / collections_register_payment)
-- — não duplicado aqui (briefing §30: "não duplicar se já existe
-- equivalente"). Os dois códigos abaixo cobrem só a superfície
-- GENUINAMENTE NOVA desta sprint: configurar identidade/PIX/templates
-- (collections.configure, equivalente a fiscal.manage/
-- communications.manage) e disparar um envio via Communication Hub
-- (collections.send, equivalente a communications.send).
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('collections.configure', 'collections', 'Configurar cobranças (identidade, PIX, templates, canais)', 220),
  ('collections.send', 'collections', 'Enviar cobrança pelo Communication Hub', 221)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('gestor', 'collections.configure'),
  ('gestor', 'collections.send'),
  ('comercial', 'collections.send')
on conflict do nothing;

-- Backfill para membros 'gestor'/'comercial' já existentes — mesmo
-- padrão de toda sprint anterior (has_org_permission lê
-- organization_member_permissions materializado, não preset_permissions
-- diretamente).
insert into public.organization_member_permissions(
  organization_id, user_id, permission_code, granted
)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = om.permission_preset
where pp.permission_code like 'collections.%'
  and om.permission_preset in ('gestor', 'comercial')
on conflict (organization_id, user_id, permission_code) do nothing;

commit;
