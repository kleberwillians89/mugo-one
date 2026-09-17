import { supabase } from '../../lib/supabase'

export type FeatureRow = { code: string; is_core: boolean }
export type FeatureOverrideRow = { feature_code: string; enabled: boolean }

/**
 * Aplica, sobre dados já buscados, exatamente a mesma regra da função SQL
 * `has_organization_feature` (migration 202609170001): uma linha
 * explícita em `organization_features` sempre vence; sem linha, o
 * módulo conta como habilitado só se `features.is_core = true`. Sem
 * esse fallback, qualquer organização sem linhas explícitas (todo
 * tenant novo, antes de qualquer configuração manual) perderia até os
 * módulos core (crm/sales) do menu — não é overhead, é a mesma regra
 * de duas tabelas, só que lida uma vez no boot em vez de reconsultada
 * por RPC a cada módulo. Extraída como função pura para ser testável
 * sem mockar o client do Supabase.
 */
export function resolveEnabledFeatureCodes(features: FeatureRow[], overrides: FeatureOverrideRow[]): Set<string> {
  const overrideByCode = new Map(overrides.map((row) => [row.feature_code, row.enabled]))
  const enabled = new Set<string>()
  for (const feature of features) {
    const explicit = overrideByCode.get(feature.code)
    if (explicit ?? feature.is_core) enabled.add(feature.code)
  }
  return enabled
}

/** Busca os códigos de módulo habilitados para a organização — ver resolveEnabledFeatureCodes. */
export async function fetchEnabledFeatureCodes(organizationId: string): Promise<Set<string>> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const [{ data: features, error: featuresError }, { data: overrides, error: overridesError }] = await Promise.all([
    supabase.from('features').select('code,is_core'),
    supabase.from('organization_features').select('feature_code,enabled').eq('organization_id', organizationId),
  ])
  if (featuresError) throw new Error(featuresError.message)
  if (overridesError) throw new Error(overridesError.message)
  return resolveEnabledFeatureCodes((features ?? []) as FeatureRow[], (overrides ?? []) as FeatureOverrideRow[])
}

export function isFeatureEnabled(enabledCodes: Set<string>, code: string): boolean {
  return enabledCodes.has(code)
}
