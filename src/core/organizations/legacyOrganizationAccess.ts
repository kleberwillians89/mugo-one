import { supabase } from '../../lib/supabase'
import { OPERATIONAL_START_DATE } from '../../lib/operational-sales'
import { resolveCurrentOrganization } from './resolveCurrentOrganization'

/**
 * Adapter legado: preserva a assinatura e o comportamento observável de
 * `authenticatedOrganization()` / `currentOrganization()` / `fetchOperationalSalesStartDate()`,
 * usados por dezenas de funções em `src/lib/records.ts`, mas troca a
 * resolução de tenant de "pegar a primeira linha de organization_members
 * sem ORDER BY" (não determinístico) para `resolveCurrentOrganization`
 * (contexto explícito e persistido — ver resolveCurrentOrganization.ts).
 *
 * Nenhum dos ~50 call sites em records.ts precisou mudar: `records.ts`
 * reexporta estas três funções para manter 100% de compatibilidade.
 */
export async function authenticatedOrganization() {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para continuar.')
  const resolved = await resolveCurrentOrganization(user.id)
  return { user, organizationId: resolved.organizationId, role: resolved.role }
}

export async function fetchOperationalSalesStartDate(organizationId: string) {
  const { data, error } = await supabase!
    .from('organizations')
    .select('operational_sales_start_date')
    .eq('id', organizationId)
    .single()
  if (error) throw new Error(error.message)
  return (data?.operational_sales_start_date as string | null) ?? OPERATIONAL_START_DATE
}

export async function currentOrganization() {
  const context = await authenticatedOrganization()
  if (context.role === 'viewer') throw new Error('Seu perfil não permite alterações.')
  return context
}
