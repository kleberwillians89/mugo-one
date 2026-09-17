-- ============================================================
-- MUGÔ ONE — Produtização (Fase B da generalização do produto ativo)
--
-- Aditiva apenas: nenhuma coluna/tabela/policy existente é alterada
-- ou removida. Objetivo: dar ao frontend (routing/Sidebar) um jeito de
-- esconder, para organizações novas, os módulos que ainda são
-- estruturalmente verticais (Radar/Interessados: só fazem sentido
-- para a operação de perfumes; Torre de Controle/Tarefas: ainda não
-- existe Task Engine genérico) sem tocar no comportamento das
-- organizações que já usam esses módulos hoje.
-- ============================================================

insert into public.features (code, label, description, is_core) values
  ('radar', 'Radar', 'Monitoramento de mercado e sinais de reposição.', false),
  ('waitlist', 'Lista de espera', 'Fila de interessados aguardando disponibilidade.', false)
on conflict (code) do nothing;

-- 'tasks' nasceu is_core=true no Sprint 1 pressupondo um Task Engine
-- genérico que ainda não existe — o conteúdo real hoje é a Torre de
-- Controle, que carrega nomes de pessoas e conceitos verticais (ver
-- docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §7). Até o Task Engine
-- genérico existir, uma organização nova não deve receber esse módulo
-- por padrão.
update public.features set is_core = false where code = 'tasks';

-- Backfill: só para organizações que já tinham 'inventory' habilitado
-- (proxy exato das organizações pré-existentes ao Sprint 1 — aquele
-- backfill habilitou inventory/shipping/tasks/etc juntos, na mesma
-- instrução, para o mesmo conjunto de organizações). Preserva o
-- comportamento observável de quem já usa esses módulos; organizações
-- criadas depois do Sprint 1 (sem nenhuma linha em
-- organization_features) simplesmente não ganham nada aqui — ficam
-- com o novo default (oculto), que é o objetivo desta migration.
insert into public.organization_features (organization_id, feature_code, enabled)
select of.organization_id, f.code, true
from (
  select distinct organization_id
  from public.organization_features
  where feature_code = 'inventory'
) of
cross join (values ('radar'), ('waitlist'), ('tasks')) as f(code)
on conflict (organization_id, feature_code) do nothing;
