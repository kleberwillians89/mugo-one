import { supabase } from '../../lib/supabase'

export type OrganizationSettings = {
  organization_id: string
  company_name: string | null
  legal_name: string | null
  document: string | null
  email: string | null
  phone: string | null
  timezone: string
  currency: string
  locale: string
  logo_url: string | null
  primary_color: string | null
  country: string
  settings: Record<string, unknown>
}

/** Lê a configuração da organização. Retorna null se ainda não houver linha (não deveria acontecer após o backfill da migration). */
export async function fetchOrganizationSettings(organizationId: string): Promise<OrganizationSettings | null> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('organization_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as OrganizationSettings | null
}

/**
 * Lê uma chave dentro de `organization_settings.settings` (metadata livre
 * por organização — ex: domínio de login interno, flags específicas),
 * com fallback explícito. Usar em vez de introduzir uma nova coluna fixa
 * para necessidades pontuais de uma única organização.
 */
export function getOrganizationSettingValue<T>(settings: OrganizationSettings | null, key: string, fallback: T): T {
  const value = settings?.settings?.[key]
  return (value as T | undefined) ?? fallback
}
