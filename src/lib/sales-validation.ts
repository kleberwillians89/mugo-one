import { authenticatedOrganization } from './records'
import { supabase } from './supabase'
import { operationalRows } from './operational-sales'

export type BlockingReason = 'perfume_nao_identificado'|'volume_nao_informado'|'pagamento_nao_identificado'|'cadastro_cliente_incompleto'

export type BlockedSale = {
  sale_id: string; client_id: string | null; client_name: string; sale_date: string; amount: number
  payment_status: string; perfume_name: string | null; volume_ml: number | null; blocking_reasons: BlockingReason[]
  assignment_id: string | null; assigned_to_name: string | null
}

const REASON_LABEL: Record<BlockingReason, string> = {
  perfume_nao_identificado: 'Perfume não identificado',
  volume_nao_informado: 'Volume não informado',
  pagamento_nao_identificado: 'Pagamento não identificado',
  cadastro_cliente_incompleto: 'Cadastro do cliente incompleto',
}

/** Human label for a blocking reason — never the raw SQL-friendly code in the UI. */
export function blockingReasonLabel(reason: BlockingReason): string {
  return REASON_LABEL[reason] ?? reason
}

export function blockingReasonLabels(reasons: BlockingReason[]): string[] {
  return reasons.map(blockingReasonLabel)
}

export async function fetchSalesValidationQueue() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('sales_validation_queue', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return operationalRows((data ?? []) as BlockedSale[])
}

export function goToSalesBlocked() {
  history.pushState({}, '', '/vendas?filtro=bloqueadas')
  dispatchEvent(new PopStateEvent('popstate'))
}

// Fase 5 (Task Delegation) — reivindicar/resolver uma venda bloqueada.
export async function assignBlockedSale(saleId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_assign', { p_entity_type: 'blocked_sale', p_entity_id: saleId })
  if (error) throw new Error(error.message)
}

export async function resolveBlockedSaleTask(assignmentId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_resolve', { p_assignment_id: assignmentId })
  if (error) throw new Error(error.message)
}
