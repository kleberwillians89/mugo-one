import { supabase } from './supabase'

/**
 * Camada de dados do portal "Minha RUAH" — deliberadamente separada de
 * records.ts. Toda função em records.ts passa por currentOrganization()/
 * authenticatedOrganization(), que exigem uma linha em organization_members
 * (cliente final NUNCA é organization_member — briefing explícito). Toda
 * chamada aqui é escopada pelo próprio auth.uid() dentro do RPC
 * (current_customer_client()) — nunca envia client_id a partir do
 * navegador.
 */

const invoke = async (name: string, body: Record<string, unknown> = {}) => {
  const { data, error } = await supabase!.functions.invoke(name, { body })
  if (error) {
    const response = (error as { context?: Response }).context
    let message = 'Não foi possível concluir a operação.'
    try { const parsed = await response?.clone().json(); message = parsed?.error?.message ?? message } catch { /* sem corpo JSON */ }
    throw new Error(message)
  }
  return data?.data
}

export const onlyDigits = (value: string) => value.replace(/\D/g, '')
export const maskCpf = (digits: string) => digits.length === 11 ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` : digits

export async function startAccountClaim(cpf: string, email: string): Promise<void> {
  await invoke('customer-claim-start', { cpf: onlyDigits(cpf), email })
}

export async function completeAccountClaim(accountId: string): Promise<void> {
  const { error } = await supabase!.rpc('customer_claim_complete', { p_account_id: accountId })
  if (error) throw new Error(error.message)
}

export async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim()
  if (trimmed.includes('@')) return trimmed
  const { email } = await invoke('customer-resolve-login', { cpf: onlyDigits(trimmed) })
  return email as string
}

export type CustodyItem = { allocation_id: string; perfume_id: string; perfume_name: string; quantity_ml: number; sale_date: string | null; requested: boolean; request_id: string | null }
export async function fetchCustody(): Promise<CustodyItem[]> {
  const { data, error } = await supabase!.rpc('customer_custody')
  if (error) throw new Error(error.message)
  return (data ?? []) as CustodyItem[]
}

export type RequestItem = { perfume: string; quantity_ml: number }
export type ShipmentRequest = {
  request_id: string; status: 'requested' | 'converted' | 'cancelled'; requested_at: string; cancelled_at: string | null
  items: RequestItem[] | null; converted_shipment_id: string | null
  shipment_status: string | null; awaiting_approval: boolean; shipping_price: number | null
  tracking_code: string | null; posted_at: string | null; delivered_at: string | null
}
export async function fetchMyRequests(): Promise<ShipmentRequest[]> {
  const { data, error } = await supabase!.rpc('customer_shipment_requests_list')
  if (error) throw new Error(error.message)
  return (data ?? []) as ShipmentRequest[]
}

export type AddressSnapshot = { name: string; postal_code: string; address_line: string; address_number: string; complement?: string; district: string; city: string; state: string; phone?: string }
export async function createShipmentRequest(allocationIds: string[], address: AddressSnapshot, notes?: string): Promise<ShipmentRequest> {
  const { data, error } = await supabase!.rpc('customer_shipment_request_create', { p_allocation_ids: allocationIds, p_address: address, p_notes: notes ?? null })
  if (error) throw new Error(error.message)
  return data as ShipmentRequest
}

export async function cancelShipmentRequest(requestId: string): Promise<void> {
  const { error } = await supabase!.rpc('customer_shipment_request_cancel', { p_request_id: requestId })
  if (error) throw new Error(error.message)
}

export async function confirmShipmentRequest(requestId: string): Promise<void> {
  const { error } = await supabase!.rpc('customer_shipment_request_confirm', { p_request_id: requestId })
  if (error) throw new Error(error.message)
}

export type PurchaseHistoryItem = { sale_id: string; sale_date: string | null; perfume_name: string | null; quantity_ml: number | null; amount: number }
export async function fetchPurchaseHistory(): Promise<PurchaseHistoryItem[]> {
  const { data, error } = await supabase!.rpc('customer_purchase_history')
  if (error) throw new Error(error.message)
  return (data ?? []) as PurchaseHistoryItem[]
}

export type DeliveryHistoryItem = { shipment_id: string; status: string; tracking_code: string | null; posted_at: string | null; delivered_at: string | null; items: RequestItem[] | null }
export async function fetchDeliveryHistory(): Promise<DeliveryHistoryItem[]> {
  const { data, error } = await supabase!.rpc('customer_delivery_history')
  if (error) throw new Error(error.message)
  return (data ?? []) as DeliveryHistoryItem[]
}

export type CustomerProfile = { name: string; email: string | null; phone: string | null; cpf_masked: string | null; postal_code: string | null; address_line: string | null; address_number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null }
export async function fetchProfile(): Promise<CustomerProfile> {
  const { data, error } = await supabase!.rpc('customer_profile')
  if (error) throw new Error(error.message)
  const row = (data ?? [])[0]
  if (!row) throw new Error('Não foi possível carregar seus dados.')
  return row as CustomerProfile
}

export const ticketCategoryLabel: Record<string, string> = {
  wrong_item: 'Recebi o perfume errado', missing_item: 'Veio faltando item', damaged_item: 'Produto chegou danificado',
  delivery_problem: 'Problema com entrega', wrong_quantity: 'Quantidade incorreta', other: 'Outro',
}
export type SupportTicket = { id: string; category: string; description: string; status: 'open' | 'in_progress' | 'resolved'; created_at: string; resolved_at: string | null }
export async function createSupportTicket(category: string, description: string, shipmentId?: string, requestId?: string): Promise<SupportTicket> {
  const { data, error } = await supabase!.rpc('customer_support_ticket_create', { p_category: category, p_description: description, p_shipment_id: shipmentId ?? null, p_request_id: requestId ?? null })
  if (error) throw new Error(error.message)
  return data as SupportTicket
}
export async function fetchMyTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase!.rpc('customer_support_tickets_list')
  if (error) throw new Error(error.message)
  return (data ?? []) as SupportTicket[]
}
