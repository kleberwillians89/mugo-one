begin;

-- ============================================================
-- MUGÔ ONE — Sprint K/L (Task Engine Universal + Kanban)
--
-- Estende entity_tags/custom_fields/custom_field_values para aceitar
-- 'task' — e SOMENTE 'task' (briefing §7: "não abrir automaticamente
-- lead/deal/sale se não for necessário para o Task Engine"; essas duas
-- tabelas já aceitavam lead/deal de uma migration anterior — 'sale' e
-- 'catalog_item' continuam de fora aqui, deliberadamente, até haver
-- necessidade real e uma sprint própria para isso).
-- ============================================================

alter table public.entity_tags drop constraint entity_tags_entity_type_check;
alter table public.entity_tags add constraint entity_tags_entity_type_check
  check (entity_type = any (array['customer','company','contact','lead','deal','task']::text[]));

alter table public.custom_fields drop constraint custom_fields_entity_type_check;
alter table public.custom_fields add constraint custom_fields_entity_type_check
  check (entity_type = any (array['customer','company','contact','lead','deal','task']::text[]));

alter table public.custom_field_values drop constraint custom_field_values_entity_type_check;
alter table public.custom_field_values add constraint custom_field_values_entity_type_check
  check (entity_type = any (array['customer','company','contact','lead','deal','task']::text[]));

commit;
