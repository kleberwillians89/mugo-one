import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

// Fila "Solicitações de clientes" (Entregas). Mesmo padrão de
// client-recovery.ts/sales-validation.ts — reivindicar/resolver via
// task_assign/task_resolve já existentes (Fase 5), nenhuma lógica de
// atribuição nova.

export type CustomerRequestQueueEntry = {
  request_id: string; client_id: string; client_name: string; status: string; requested_at: string
  item_count: number; total_ml: number; items: { perfume: string; quantity_ml: number }[] | null
  assignment_id: string | null; assigned_to_name: string | null
}

export async function fetchCustomerShipmentRequestsQueue() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('customer_shipment_requests_queue', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as CustomerRequestQueueEntry[]
}

export async function claimCustomerShipmentRequest(requestId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_assign', { p_entity_type: 'customer_shipment_request', p_entity_id: requestId })
  if (error) throw new Error(error.message)
}

/** "COTAR FRETE": cria o shipment real a partir da solicitação (endereço
 * já confirmado pela cliente) — devolve o shipment_id para a equipe
 * continuar pelo fluxo operacional já existente (cotação/aprovação/
 * checkout/postagem, sem nenhuma mudança). */
export async function quoteCustomerShipmentRequest(requestId: string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('create_draft_shipment_from_customer_request', { p_request_id: requestId })
  if (error) throw new Error(error.message)
  return data as string
}

export type SupportTicketQueueEntry = {
  ticket_id: string; client_id: string; client_name: string; category: string; description: string; status: string
  created_at: string; shipment_id: string | null; assignment_id: string | null; assigned_to_name: string | null
}
export async function fetchSupportTicketsQueue() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('customer_support_tickets_queue', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as SupportTicketQueueEntry[]
}
export async function claimSupportTicket(ticketId: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('task_assign', { p_entity_type: 'customer_support_ticket', p_entity_id: ticketId })
  if (error) throw new Error(error.message)
}
export async function resolveSupportTicket(ticketId: string, note?: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('customer_support_ticket_resolve', { p_ticket_id: ticketId, p_resolution_note: note ?? null })
  if (error) throw new Error(error.message)
}
