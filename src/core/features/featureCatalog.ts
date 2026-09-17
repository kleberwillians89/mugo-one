/**
 * Catálogo de módulos ativáveis por organização — espelha a tabela
 * `public.features` (ver migration 202609170001). Mantido em código só
 * para uso em UI (rótulos); a fonte de verdade de habilitação é sempre
 * o banco (`organization_features` / `has_organization_feature`).
 */
export type FeatureCode =
  | 'crm'
  | 'tasks'
  | 'sales'
  | 'catalog'
  | 'inventory'
  | 'shipping'
  | 'communications'
  | 'automations'
  | 'ai'
  | 'customer_portal'
  | 'fiscal'
  | 'radar'
  | 'waitlist'

export type FeatureDefinition = {
  code: FeatureCode
  label: string
  /** Módulos "core" ficam habilitados por padrão mesmo sem linha em organization_features. */
  isCore: boolean
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { code: 'crm', label: 'CRM', isCore: true },
  // 'tasks' voltou a is_core=true na migration 202609220005: o Task
  // Engine universal existe agora (Sprint K/L) — a demoção em
  // 202609200001 era só porque o conteúdo de então era a Torre de
  // Controle vertical, que nunca foi o Task Engine (ver
  // docs/TASK_ENGINE_MIGRATION_PLAN.md). Automações futuras dependem
  // de tasks existir sempre, por isso core sem exceção.
  { code: 'tasks', label: 'Tarefas', isCore: true },
  { code: 'sales', label: 'Vendas', isCore: true },
  // Sem catálogo não existe "Nova venda" — core, sem exceção por organização.
  { code: 'catalog', label: 'Catálogo', isCore: true },
  { code: 'inventory', label: 'Estoque', isCore: false },
  { code: 'shipping', label: 'Entregas', isCore: false },
  { code: 'communications', label: 'Comunicação', isCore: false },
  { code: 'automations', label: 'Automações', isCore: false },
  { code: 'ai', label: 'Inteligência artificial', isCore: false },
  { code: 'customer_portal', label: 'Portal do cliente', isCore: false },
  { code: 'fiscal', label: 'Fiscal', isCore: false },
  { code: 'radar', label: 'Radar', isCore: false },
  { code: 'waitlist', label: 'Lista de espera', isCore: false },
]
