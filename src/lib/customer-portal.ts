import { supabase } from './supabase'

/**
 * Camada de dados do Portal do Cliente — deliberadamente separada de
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

export function customerPortalErrorMessage(reason: unknown, fallback = 'Não foi possível concluir esta ação. Tente novamente.') {
  const raw = reason instanceof Error ? reason.message : String((reason as { message?: unknown })?.message ?? reason ?? '')
  const normalized = raw.toLowerCase()
  if (normalized.includes('shipping_availability_pending')) return 'Este perfume está previsto, mas ainda não teve a chegada confirmada. A solicitação de envio será liberada assim que ele estiver disponível.'
  if (normalized.includes('invalid_or_unavailable_custody') || normalized.includes('already_requested')) return 'Este perfume já está vinculado a uma solicitação ou não está mais disponível para um novo envio.'
  if (normalized.includes('active_shipment_exists')) return 'Você já possui um envio em andamento. Os novos perfumes ficarão disponíveis para a próxima solicitação quando este envio for concluído.'
  if (normalized.includes('quote_changed') || normalized.includes('quote_not_available')) return 'A cotação deste envio mudou ou não está mais disponível. Aguarde uma nova cotação da nossa equipe.'
  if (normalized.includes('request_already_in_progress') || normalized.includes('request_cannot_be_cancelled') || normalized.includes('shipment_cannot_be_cancelled')) return 'Esta solicitação já avançou e não pode mais ser cancelada por aqui. Fale com a nossa equipe.'
  if (normalized.includes('external_shipping_cancellation_requires_review')) return 'Este envio já entrou em processamento. Fale com a nossa equipe para continuar.'
  if (normalized.includes('forbidden') || normalized.includes('permission_denied') || normalized.includes('42501')) return 'Você não tem acesso a esta solicitação.'
  if (normalized.includes('request_not_found') || normalized.includes('pgrst116')) return 'Não encontramos esta solicitação. Atualize a página e tente novamente.'
  if (normalized.includes('invalid_status')) return 'Esta ação não está disponível na etapa atual.'
  return fallback
}

const portalRpcError = (error: unknown, fallback?: string): never => { throw new Error(customerPortalErrorMessage(error, fallback)) }

export async function startAccountClaim(cpf: string, email: string): Promise<void> {
  await invoke('customer-claim-start', { cpf: onlyDigits(cpf), email })
}

export async function completeAccountClaim(accountId: string): Promise<void> {
  const { error } = await supabase!.rpc('customer_claim_complete', { p_account_id: accountId })
  if (error) throw new Error(error.message)
}

export async function activateCurrentCustomerAccount():Promise<boolean>{
  const {data,error}=await supabase!.rpc('customer_account_activate_current')
  if(error)throw new Error(error.message)
  return data===true
}

export async function hasValidFirstAccessContext():Promise<boolean>{
  const {data,error}=await supabase!.rpc('customer_first_access_context_valid')
  return !error&&data===true
}

export async function startPublicRegistration(name:string,email:string,phone:string):Promise<{code:'invite_sent';status:'invite_sent';email:string;provider_message_id?:string}>{
  return await invoke('customer-registration-start',{name,email,phone})
}

export async function finalizeCustomerIdentity():Promise<'linked'|'review_required'>{
  const {data,error}=await supabase!.rpc('customer_identity_finalize')
  if(error)throw new Error(error.message)
  return data as 'linked'|'review_required'
}

export type CustodyItem = { allocation_id: string; perfume_id: string; perfume_name: string; quantity_ml: number; sale_date: string | null; allocation_status: 'reserved' | 'shipping'; requested: boolean; request_id: string | null; shipping_availability_text?:string|null; shipping_availability_kind?:string|null; shipping_available_date?:string|null; shipping_lead_business_days?:number|null; shipping_availability_confirmed_at?:string|null; shipping_requestable?:boolean;requestable_quantity_ml?:number;prepared_quantity_ml?:number }
export async function fetchCustody(): Promise<CustodyItem[]> {
  const { data, error } = await supabase!.rpc('customer_custody')
  if (error) portalRpcError(error, 'Não foi possível carregar seus perfumes agora.')
  return (data ?? []) as CustodyItem[]
}

export type RequestItem = { allocation_id?: string; perfume_id?: string; perfume: string; quantity_ml: number }
export type ShipmentRequest = {
  request_id: string; status: 'requested' | 'converted' | 'cancelled'; requested_at: string; cancelled_at: string | null
  customer_request_id?: string | null; source?: 'request' | 'shipment'
  items: RequestItem[] | null; converted_shipment_id: string | null
  shipment_status: string | null; awaiting_approval: boolean; shipping_price: number | null
  carrier: string | null; service: string | null; selected_quote_id: string | null; customer_approved_at: string | null
  tracking_code: string | null; posted_at: string | null; delivered_at: string | null
}
export async function fetchMyRequests(): Promise<ShipmentRequest[]> {
  const [requestResult,shipmentResult]=await Promise.all([
    supabase!.rpc('customer_shipment_requests_list'),
    supabase!.rpc('customer_shipments_list'),
  ])
  if(requestResult.error)portalRpcError(requestResult.error,'Não foi possível carregar seus envios agora.')
  if(shipmentResult.error)portalRpcError(shipmentResult.error,'Não foi possível carregar seus envios agora.')
  const rawRequests=(requestResult.data??[]) as Omit<ShipmentRequest,'customer_request_id'|'source'>[]
  const shipments=(shipmentResult.data??[]) as Array<{shipment_id:string;status:string;created_at:string;items:RequestItem[]|null;shipping_price:number|null;carrier:string|null;service:string|null;selected_quote_id:string|null;customer_approved_at:string|null;tracking_code:string|null;posted_at:string|null;delivered_at:string|null;cancelled_at:string|null}>
  const shipmentIds=new Set(shipments.map(item=>item.shipment_id))
  const pending=rawRequests.filter(item=>!item.converted_shipment_id||!shipmentIds.has(item.converted_shipment_id)).map(item=>({...item,customer_request_id:item.request_id,source:'request' as const}))
  const canonical=shipments.map(shipment=>{const request=rawRequests.find(item=>item.converted_shipment_id===shipment.shipment_id);return {request_id:`shipment:${shipment.shipment_id}`,customer_request_id:request?.request_id??null,source:'shipment' as const,status:'converted' as const,requested_at:request?.requested_at??shipment.created_at,cancelled_at:request?.cancelled_at??shipment.cancelled_at,items:shipment.items,converted_shipment_id:shipment.shipment_id,shipment_status:shipment.status,awaiting_approval:shipment.status==='awaiting_customer_approval',shipping_price:shipment.shipping_price,carrier:shipment.carrier,service:shipment.service,selected_quote_id:shipment.selected_quote_id,customer_approved_at:shipment.customer_approved_at,tracking_code:shipment.tracking_code,posted_at:shipment.posted_at,delivered_at:shipment.delivered_at}})
  return [...canonical,...pending]
}

export type AddressSnapshot = { name: string; postal_code: string; address_line: string; address_number: string; complement?: string; district: string; city: string; state: string; phone?: string }
export async function createShipmentRequest(allocationIds: string[], address: AddressSnapshot, notes?: string): Promise<ShipmentRequest> {
  const custody=await fetchCustody(),items=allocationIds.map(allocationId=>{const item=custody.find(row=>row.allocation_id===allocationId);return{allocation_id:allocationId,quantity_ml:Number(item?.requestable_quantity_ml??item?.quantity_ml??0)}})
  const { data, error } = await supabase!.rpc('customer_shipment_request_create_prepared', { p_items:items, p_address: address, p_notes: notes ?? null })
  if (error) portalRpcError(error, 'Não foi possível criar esta solicitação de envio.')
  return data as ShipmentRequest
}

export async function cancelShipmentRequest(requestId: string): Promise<void> {
  const { error } = await supabase!.rpc('customer_shipment_request_cancel', { p_request_id: requestId })
  if (error) portalRpcError(error, 'Não foi possível cancelar esta solicitação agora.')
}

export type PurchaseHistoryItem = { sale_id: string; sale_date: string | null; perfume_name: string | null; quantity_ml: number | null; amount: number }
export async function fetchPurchaseHistory(): Promise<PurchaseHistoryItem[]> {
  const { data, error } = await supabase!.rpc('customer_purchase_history')
  if (error) portalRpcError(error, 'Não foi possível carregar seu histórico de compras agora.')
  return (data ?? []) as PurchaseHistoryItem[]
}

export type DeliveryHistoryItem = { shipment_id: string; status: string; tracking_code: string | null; posted_at: string | null; delivered_at: string | null; items: RequestItem[] | null }
export async function fetchDeliveryHistory(): Promise<DeliveryHistoryItem[]> {
  const { data, error } = await supabase!.rpc('customer_delivery_history')
  if (error) portalRpcError(error, 'Não foi possível carregar seu histórico de envios agora.')
  return (data ?? []) as DeliveryHistoryItem[]
}

export type CustomerProfile = { name: string; email: string | null; phone: string | null; cpf_masked: string | null; postal_code: string | null; address_line: string | null; address_number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null }
export async function fetchProfile(): Promise<CustomerProfile> {
  const { data, error } = await supabase!.rpc('customer_profile')
  if (error) portalRpcError(error, 'Não foi possível carregar seus dados agora.')
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
  if (error) portalRpcError(error, 'Não foi possível enviar sua mensagem agora.')
  return data as SupportTicket
}
export async function fetchMyTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase!.rpc('customer_support_tickets_list')
  if (error) portalRpcError(error, 'Não foi possível carregar seus chamados agora.')
  return (data ?? []) as SupportTicket[]
}
