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
  | 'inventory'
  | 'shipping'
  | 'communications'
  | 'automations'
  | 'ai'
  | 'customer_portal'
  | 'fiscal'

export type FeatureDefinition = {
  code: FeatureCode
  label: string
  /** Módulos "core" ficam habilitados por padrão mesmo sem linha em organization_features. */
  isCore: boolean
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { code: 'crm', label: 'CRM', isCore: true },
  { code: 'tasks', label: 'Tarefas', isCore: true },
  { code: 'sales', label: 'Vendas', isCore: true },
  { code: 'inventory', label: 'Estoque', isCore: false },
  { code: 'shipping', label: 'Entregas', isCore: false },
  { code: 'communications', label: 'Comunicação', isCore: false },
  { code: 'automations', label: 'Automações', isCore: false },
  { code: 'ai', label: 'Inteligência artificial', isCore: false },
  { code: 'customer_portal', label: 'Portal do cliente', isCore: false },
  { code: 'fiscal', label: 'Fiscal', isCore: false },
]
