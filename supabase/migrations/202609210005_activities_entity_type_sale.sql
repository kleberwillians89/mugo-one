begin;

-- ============================================================
-- MUGÔ ONE — Sprint "Catálogo Universal + Sale Items" (Fase F)
--
-- Bug real encontrado no smoke test ao vivo: 202609210003_sale_items.sql
-- ensinou entity_belongs_to_organization() a validar 'sale'/'catalog_item',
-- mas esqueceu que activities.entity_type também tem uma CHECK constraint
-- própria (customer|company|contact|lead|deal) — sem este fix,
-- log_activity() para uma venda falha na hora do INSERT em activities,
-- não na validação de tenant (create_sale_with_items ficava impossível
-- de usar). Aditivo: só amplia o conjunto permitido, não remove nada.
-- ============================================================

alter table public.activities drop constraint activities_entity_type_check;
alter table public.activities add constraint activities_entity_type_check
  check (entity_type = any (array['customer','company','contact','lead','deal','sale','catalog_item']::text[]));

commit;
