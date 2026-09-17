begin;

-- ============================================================
-- MUGÔ ONE — Sprint K/L (Task Engine Universal + Kanban)
--
-- 'tasks' volta a is_core=true: a migration 202609200001 (Fase A-D)
-- tinha demovido para false porque o único conteúdo de 'tasks' até
-- então era a Torre de Controle vertical — nunca um Task Engine de
-- verdade. Agora que o Task Engine universal existe (ver
-- docs/TASK_ENGINE_MIGRATION_PLAN.md), toda organização — inclusive
-- as já existentes, sem precisar de override em organization_features
-- — passa a ter acesso a /tarefas por padrão. Automações futuras
-- (briefing §30) dependem de tasks existir sempre.
-- ============================================================

update public.features set is_core = true where code = 'tasks';

commit;
