begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- Permissões + feature flag. lead_intake é CORE (is_core=true) desde
-- o início: é a porta de entrada universal do CRM, não um módulo
-- opcional — ver docs/LEAD_INTAKE_MIGRATION_PLAN.md §Feature.
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('lead_intake.view', 'lead_intake', 'Visualizar entradas de leads', 170),
  ('lead_intake.manage', 'lead_intake', 'Gerenciar endpoints de entrada de leads', 171)
on conflict (code) do nothing;

insert into public.preset_permissions (preset, permission_code) values
  ('gestor', 'lead_intake.view'),
  ('gestor', 'lead_intake.manage'),
  ('comercial', 'lead_intake.view')
on conflict do nothing;

insert into public.features (code, label, description, is_core) values
  ('lead_intake', 'Entrada de leads', 'Porta de entrada universal para leads vindos de site, formulário, webhook ou API — normalização, identidade e touchpoints.', true)
on conflict (code) do nothing;

commit;
