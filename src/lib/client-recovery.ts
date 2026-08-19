import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type ClientRecoveryEntry = {
  client_id: string; client_name: string; phone: string | null; whatsapp_phone: string | null
  purchase_count: number; total_purchased: number; last_purchase: string; days_since_last_purchase: number
  assignment_id: string | null; assigned_to_name: string | null
}

export async function fetchClientRecoveryQueue() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('client_recovery_queue', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientRecoveryEntry[]
}

export function goToClientRecovery() {
  history.pushState({}, '', '/clientes/recuperacao')
  dispatchEvent(new PopStateEvent('popstate'))
}

// Fase 5 (Task Delegation) reaproveitada — reivindicar/concluir uma recuperação de cliente.
export async function assignClientRecovery(clientId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_assign', { p_entity_type: 'customer_recovery', p_entity_id: clientId })
  if (error) throw new Error(error.message)
}

export async function resolveClientRecoveryTask(assignmentId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_resolve', { p_assignment_id: assignmentId })
  if (error) throw new Error(error.message)
}

/** 180 dias = o dobro do limiar de entrada na fila (90) — cliente que já ultrapassou o próprio limiar de "sumiu" duas vezes. */
export function recoveryUrgencyTone(daysSinceLastPurchase: number): 'danger' | 'warning' {
  return daysSinceLastPurchase >= 180 ? 'danger' : 'warning'
}

export function bestContact(entry: Pick<ClientRecoveryEntry, 'whatsapp_phone' | 'phone'>): string {
  return entry.whatsapp_phone || entry.phone || '—'
}
