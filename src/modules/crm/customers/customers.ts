import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { CUSTOMER_COLUMNS, toCustomer, type ClientRow, type Customer } from './customer.types'

/**
 * Só leitura por enquanto — criação/edição de customer continuam em
 * src/lib/records.ts (createClient/updateClient), que já tem dedupe
 * (findPossibleClients) e validação testados; duplicar essa lógica
 * aqui seria reescrever o que já funciona. Este módulo existe para dar
 * ao resto do CRM (tags, custom fields, notes, activities) uma leitura
 * genérica de "customer" sem precisar conhecer a tabela `clients`.
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('clients')
    .select(CUSTOMER_COLUMNS)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as ClientRow[]).map(toCustomer)
}

export async function fetchCustomer(customerId: string): Promise<Customer | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('clients')
    .select(CUSTOMER_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toCustomer(data as ClientRow) : null
}
