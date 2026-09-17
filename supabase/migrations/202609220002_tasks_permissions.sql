begin;

-- ============================================================
-- MUGÔ ONE — Sprint K/L (Task Engine Universal + Kanban)
--
-- Permissions novas e distintas das 4 antigas (tasks.sales/tasks.split/
-- tasks.shipping/tasks.management, seedadas em
-- 202609120003_role_scoped_tasks.sql com identidade de pessoas reais
-- da operação antiga — ver docs/TASK_ENGINE_MIGRATION_PLAN.md). Este
-- Task Engine nunca reaproveita aquelas 4; usa um namespace próprio
-- que não colide com elas.
-- ============================================================

insert into public.permissions (code, module, label, sort_order) values
  ('tasks.view', 'task_engine', 'Visualizar tarefas', 160),
  ('tasks.create', 'task_engine', 'Criar tarefas', 161),
  ('tasks.edit', 'task_engine', 'Editar tarefas', 162),
  ('tasks.assign', 'task_engine', 'Atribuir tarefas', 163),
  ('tasks.manage', 'task_engine', 'Gerenciar tarefas (excluir/cancelar de terceiros)', 164)
on conflict (code) do nothing;

-- gestor já recebe tudo automaticamente (select 'gestor', code from
-- permissions where code <> 'team.manage', ver 202608190011) — exceto
-- os códigos inseridos DEPOIS daquele insert original, que precisam de
-- uma linha explícita aqui, mesmo padrão já usado em 202609210001.
insert into public.preset_permissions (preset, permission_code)
select 'gestor', code from public.permissions
where code in ('tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.manage')
on conflict do nothing;

-- comercial: cria/vê/edita tarefas (fluxo comercial depende disso —
-- follow-up de lead, proposta, cobrança), sem gerenciar (excluir
-- tarefa de outra pessoa fica só para admin/gestor).
insert into public.preset_permissions (preset, permission_code) values
  ('comercial', 'tasks.view'),
  ('comercial', 'tasks.create'),
  ('comercial', 'tasks.edit'),
  ('comercial', 'tasks.assign'),
  ('entregas', 'tasks.view'),
  ('entregas', 'tasks.create'),
  ('estoque', 'tasks.view')
on conflict do nothing;

commit;
