import { supabase } from '../../lib/supabase'

/**
 * Busca os códigos de módulo habilitados para a organização. Ainda não é
 * consumida por nenhuma página nesta sprint — deliberado: o objetivo é
 * preparar a arquitetura de feature modules sem espalhar
 * `if (feature === ...)` pelo frontend antes de termos uma UI real de
 * configuração por organização.
 */
export async function fetchEnabledFeatureCodes(organizationId: string): Promise<Set<string>> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('organization_features')
    .select('feature_code,enabled')
    .eq('organization_id', organizationId)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).filter((row) => row.enabled).map((row) => row.feature_code as string))
}

export function isFeatureEnabled(enabledCodes: Set<string>, code: string): boolean {
  return enabledCodes.has(code)
}
