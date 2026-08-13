import { normalizeClient } from './importer'
import { supabase } from './supabase'
import type { PeriodValue } from './period'

export async function authenticatedOrganization() {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para continuar.')
  const { data, error } = await supabase.from('organization_members')
    .select('organization_id,role').eq('user_id', user.id).limit(1).single()
  if (error || !data) throw new Error('Usuário sem organização vinculada.')
  return { user, organizationId: data.organization_id as string, role: data.role as string }
}

export async function currentOrganization() {
  const context = await authenticatedOrganization()
  if (context.role === 'viewer') throw new Error('Seu perfil não permite alterações.')
  return context
}

export type DashboardMetrics = {
  clients:number; sales:number; paid:number; pending:number; cancelled:number; review:number
  paid_rows:number; pending_rows:number; cancelled_rows:number; review_rows:number
  raw_gross:number; batch_rows:number; stock_rows:number; stock_pending:number
  preserved_review_rows:number; possible_duplicates:number; first_sale:string|null; last_sale:string|null
}

export async function fetchDashboardMetrics() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('dashboard_commercial_metrics', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return data as DashboardMetrics
}

export type PeriodSummary = {
  period_start:string;period_end:string;sales:number;total:number;paid:number;pending:number
  cancelled:number;review:number;paid_count:number;pending_count:number;cancelled_count:number
  review_count:number;average_ticket:number;buying_clients:number;new_clients:number
  recurring_clients:number;deliveries_pending:number;deliveries_overdue:number
  shipped_today:number;shipped_in_period:number;shipped_on_time:number;shipped_late:number
  without_deadline:number;daily:{period_date:string;sales:number;paid:number;pending:number}[]
  payment_methods:{name:string;items:number;value:number}[]
  top_perfumes:{name:string;items:number;ml:number;value:number}[]
  top_clients:{name:string;items:number;value:number}[]
}

export async function fetchPeriodSummary(period:PeriodValue) {
  const { organizationId }=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('commercial_period_summary',{
    org_id:organizationId,start_date:period.start,end_date:period.end,
  })
  if(error)throw new Error(error.message)
  return data as PeriodSummary
}

export type ClientCommercialSummary = {
  client_id:string; client:string; total_purchased:number; paid:number; pending:number
  cancelled:number; review:number; item_count:number; average_ticket:number
  total_ml:number; perfumes:string[]; sale_types:string[]
  first_purchase:string|null; last_purchase:string|null
}

export async function fetchClientSummaries() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('client_commercial_summary', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientCommercialSummary[]
}

export async function fetchClientPeriodSummaries(period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('client_period_summary',{
    org_id:organizationId,start_date:period.start,end_date:period.end,
  })
  if(error)throw new Error(error.message)
  return data ?? []
}

export type Client360 = {
  client:{id:string;name:string;phone:string|null;whatsapp_phone:string|null;email:string|null;cpf:string|null;cnpj:string|null;instagram:string|null;birth_date:string|null;postal_code:string|null;address_line:string|null;address_number:string|null;complement:string|null;district:string|null;city:string|null;state:string|null;notes:string|null;status:string;source:string;registration_origin:string|null;created_at:string;updated_at:string}
  commercial:{purchases:number;total_purchased:number;paid:number;pending:number;cancelled:number;credit:number;average_ticket:number;total_ml:number;first_purchase:string|null;last_purchase:string|null;top_perfume:string|null;top_perfume_value:number|null}
  waiting:{waiting_ml:number;waiting_products:number}
}

export type WaitingProduct = {
  allocation_id:string;sale_id:string;sale_date:string;perfume:string;sale_type:string
  quantity_ml:number;amount:number;payment_status:string;allocated_at:string;days_waiting:number
}

export async function fetchClient360(clientId:string) {
  await authenticatedOrganization()
  const [{data:profile,error:profileError},{data:history,error:historyError},{data:waiting,error:waitingError},{data:shipments,error:shipmentsError}]=await Promise.all([
    supabase!.rpc('client_360',{p_client_id:clientId}),
    supabase!.from('sales').select('id,sale_date,amount,payment_status,payment_method,paid_at,perfume_name_raw,sale_type,volume_ml,notes,source,shipped_at,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))').eq('client_id',clientId).is('deleted_at',null).order('sale_date',{ascending:false}),
    supabase!.rpc('client_waiting_products',{p_client_id:clientId}),
    supabase!.from('shipments').select('id,status,requested_at,carrier,service,shipping_price,tracking_code,posted_at,delivered_at,created_at,shipment_items(sale_id,quantity_ml,sales(perfume_name_raw))').eq('client_id',clientId).order('created_at',{ascending:false}),
  ])
  const error=profileError||historyError||waitingError||shipmentsError
  if(error)throw new Error(error.message)
  return {profile:profile as Client360,history:history??[],waiting:(waiting??[]) as WaitingProduct[],shipments:shipments??[]}
}

export async function createDraftShipment(clientId:string,allocationIds:string[],notes='') {
  await currentOrganization()
  const {data,error}=await supabase!.rpc('create_draft_shipment',{p_client_id:clientId,p_allocation_ids:allocationIds,p_notes:notes||null})
  if(error)throw new Error(error.message)
  return data as string
}

export type CommercialSale = {
  id:string; client_id:string|null; sale_date:string|null; amount:number; payment_status:string
  payment_method:string|null; paid_at:string|null; original_client:string|null
  perfume_name_raw:string|null; bottle_identifier:string|null; sale_type:string|null
  volume_ml:number|null; shipping_deadline_raw:string|null;shipping_deadline_date:string|null
  shipping_operational_status:string|null; shipped_at:string|null; notes:string|null;source:string
  credit_reference_amount?:number|null;inventory_allocation_eligible?:boolean
  clients:{name:string;phone?:string|null;whatsapp_phone?:string|null;email?:string|null;cpf?:string|null;cnpj?:string|null;postal_code?:string|null;address_line?:string|null;address_number?:string|null;complement?:string|null;district?:string|null;city?:string|null;state?:string|null}|null
  inventory_allocations?:{id:string;status:string;quantity_ml:number;shipment_id:string|null;inventory_items:{id:string;current_ml:number}|null}[]
  shipment_items?:{shipment_id:string;shipments:{id:string;status:string;carrier:string|null;service:string|null;tracking_code:string|null;posted_at:string|null;delivered_at:string|null}|null}[]
}

export type SaleFilters = {
  period?:PeriodValue; paymentStart?:string;paymentEnd?:string;shippingStart?:string;shippingEnd?:string
  search?:string;client?:string;perfume?:string;type?:string;status?:string;method?:string
  origin?:string;volumeMl?:number;minValue?:number;maxValue?:number;delivery?:string;sort?:string
}

export async function fetchSalesPage(filters:SaleFilters={},page=0,pageSize=50) {
  const { organizationId } = await authenticatedOrganization()
  let query=supabase!.from('sales')
    .select('id,client_id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,clients(name),shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))', { count:'exact' })
    .eq('organization_id', organizationId).is('deleted_at', null)
  if(filters.period)query=query.gte('sale_date',filters.period.start).lte('sale_date',filters.period.end)
  if(filters.paymentStart)query=query.gte('paid_at',filters.paymentStart)
  if(filters.paymentEnd)query=query.lte('paid_at',filters.paymentEnd)
  if(filters.shippingStart)query=query.gte('shipped_at',filters.shippingStart)
  if(filters.shippingEnd)query=query.lte('shipped_at',filters.shippingEnd)
  if(filters.client)query=query.ilike('client_name_raw',`%${filters.client}%`)
  if(filters.perfume)query=query.ilike('perfume_name_raw',`%${filters.perfume}%`)
  if(filters.type)query=query.eq('sale_type',filters.type)
  if(filters.volumeMl!==undefined)query=query.eq('volume_ml',filters.volumeMl)
  if(filters.status)query=query.eq('payment_status',filters.status)
  if(filters.method)query=query.ilike('payment_method',`%${filters.method}%`)
  if(filters.origin)query=query.eq('source',filters.origin)
  if(filters.minValue!==undefined)query=query.gte('amount',filters.minValue)
  if(filters.maxValue!==undefined)query=query.lte('amount',filters.maxValue)
  if(filters.search)query=query.or(`client_name_raw.ilike.%${filters.search}%,perfume_name_raw.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`)
  const sort=filters.sort??'sale_date_desc'
  const [column,direction]=sort.replace(/_(asc|desc)$/,'|$1').split('|')
  query=query.order(column,{ascending:direction==='asc',nullsFirst:false}).range(page*pageSize,page*pageSize+pageSize-1)
  const {data,error,count}=await query
  if (error) throw new Error(error.message)
  return { rows:(data ?? []) as unknown as CommercialSale[], count:count ?? 0 }
}

export async function fetchSale360(saleId:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('sales').select('id,client_id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,credit_reference_amount,inventory_allocation_eligible,clients(name,phone,whatsapp_phone,email,cpf,cnpj,postal_code,address_line,address_number,complement,district,city,state),inventory_allocations(id,status,quantity_ml,shipment_id,inventory_items(id,current_ml)),shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))').eq('organization_id',organizationId).eq('id',saleId).is('deleted_at',null).single()
  if(error)throw new Error(error.message)
  return data as unknown as CommercialSale
}

export type ReservedAllocation={id:string;client_id:string;sale_id:string;quantity_ml:number;allocated_at:string;clients:{name:string}|null;sales:{sale_date:string|null;amount:number;perfume_name_raw:string|null;sale_type:string|null}|null}
export async function fetchReservedAllocations(){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('inventory_allocations').select('id,client_id,sale_id,quantity_ml,allocated_at,clients(name),sales(sale_date,amount,perfume_name_raw,sale_type)').eq('organization_id',organizationId).eq('status','reserved').order('allocated_at',{ascending:true})
  if(error)throw new Error(error.message)
  return (data??[]) as unknown as ReservedAllocation[]
}

export async function fetchDeliveryRows(period?:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const result:CommercialSale[]=[]
  for(let from=0;;from+=1000){
    let query=supabase!.from('sales').select('id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,clients(name),shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))')
      .eq('organization_id',organizationId).is('deleted_at',null).range(from,from+999)
    if(period)query=query.gte('sale_date',period.start).lte('sale_date',period.end)
    const {data,error}=await query
    if(error)throw new Error(error.message)
    result.push(...((data??[]) as unknown as CommercialSale[]))
    if((data?.length??0)<1000)break
  }
  return result
}

export async function updateShipment(saleId:string,shippedAt:string|null) {
  const {role}=await authenticatedOrganization()
  if(role==='viewer')throw new Error('Perfil somente leitura.')
  const {error}=await supabase!.from('sales').update({shipped_at:shippedAt,updated_at:new Date().toISOString()}).eq('id',saleId)
  if(error)throw new Error(error.message)
}

export type LogisticsSummary={identified_shipments:number;shipped_in_period:number;historical_on_time:number;historical_late:number;average_days_to_ship:number|null;operational_backlog:number;shipments_preparing:number;awaiting_approval:number;labels_released:number;posted:number;delivered:number}
export async function fetchLogisticsSummary(period:PeriodValue){const {organizationId}=await authenticatedOrganization();const {data,error}=await supabase!.rpc('logistics_operational_summary',{org_id:organizationId,start_date:period.start,end_date:period.end});if(error)throw new Error(error.message);return data as LogisticsSummary}

export type ShipmentQuote={id:string;service_id:string;service_name:string;carrier:string|null;price:number;delivery_days:number|null;delivery_min:number|null;delivery_max:number|null;available:boolean;safe_error:string|null;package:Record<string,unknown>}
export type OperationalShipment={
  id:string;organization_id:string;client_id:string;status:string;created_at:string;recipient_name:string;recipient_phone:string|null
  recipient_document:string|null;recipient_email:string|null;recipient_postal_code:string|null;recipient_address:string|null
  recipient_number:string|null;recipient_complement:string|null;recipient_district:string|null;recipient_city:string|null;recipient_state:string|null
  package_weight:number|null;package_height:number|null;package_width:number|null;package_length:number|null;package_format:string|null
  declared_value:number|null;fiscal_mode:string;selected_quote_id:string|null;carrier:string|null;service:string|null;service_id:string|null
  shipping_price:number|null;superfrete_order_id:string|null;superfrete_status:string|null;checkout_status:string|null
  tracking_code:string|null;print_url:string|null;label_pdf_url:string|null;integration_error:string|null
  clients:{name:string}|null;shipment_quotes:ShipmentQuote[];shipment_items:{quantity_ml:number;sales:{id:string;amount:number;perfume_name_raw:string|null;sale_type:string|null}|null}[]
  shipment_events?:{id:number;event_type:string;from_status:string|null;to_status:string|null;metadata:Record<string,unknown>;created_at:string}[]
}

export async function fetchOperationalShipments(){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select('*,clients(name),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),shipment_items(quantity_ml,sales(id,amount,perfume_name_raw,sale_type))').eq('organization_id',organizationId).order('created_at',{ascending:false})
  if(error)throw new Error(error.message)
  return (data??[]) as unknown as OperationalShipment[]
}
export async function fetchShipment360(shipmentId:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select('*,clients(name),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),shipment_items(quantity_ml,sales(id,amount,perfume_name_raw,sale_type)),shipment_events(id,event_type,from_status,to_status,metadata,created_at)').eq('organization_id',organizationId).eq('id',shipmentId).order('created_at',{referencedTable:'shipment_events',ascending:false}).single()
  if(error)throw new Error(error.message)
  return data as unknown as OperationalShipment
}
export async function updateShipmentShippingData(shipmentId:string,data:Record<string,unknown>){await currentOrganization();const {data:shipment,error}=await supabase!.rpc('update_shipment_shipping_data',{p_shipment_id:shipmentId,p_data:data});if(error)throw new Error(error.message);return shipment as OperationalShipment}
export async function refreshShipmentRecipient(shipmentId:string){await currentOrganization();const {data,error}=await supabase!.rpc('refresh_shipment_recipient',{p_shipment_id:shipmentId});if(error)throw new Error(error.message);return data as OperationalShipment}
export async function selectShipmentQuote(shipmentId:string,quoteId:string){await currentOrganization();const {error}=await supabase!.rpc('select_shipment_quote',{p_shipment_id:shipmentId,p_quote_id:quoteId});if(error)throw new Error(error.message)}
export async function approveShipmentForLabel(shipmentId:string){await currentOrganization();const {error}=await supabase!.rpc('approve_shipment_for_label',{p_shipment_id:shipmentId});if(error)throw new Error(error.message)}

async function invokeShipmentFunction(name:string,shipmentId:string){
  const {organizationId}=await currentOrganization(),{data,error}=await supabase!.functions.invoke(name,{body:{organization_id:organizationId,shipment_id:shipmentId}})
  if(error){const response=(error as {context?:Response}).context;let message='Falha na integração SuperFrete.',code='';try{const body=await response?.clone().json();message=body?.error?.message??message;code=String(body?.error?.code??'')}catch{/* resposta sem JSON */}const status=response?.status?` HTTP ${response.status}.`:'';const reference=response?.headers.get('x-request-id');throw new Error(`${message}${status}${code?` Código: ${code}.`:''}${reference?` Referência: ${reference}.`:''}`)}
  return data?.data
}
export const quoteShipment=(shipmentId:string)=>invokeShipmentFunction('superfrete-quote',shipmentId)
export const createSuperFreteLabel=(shipmentId:string)=>invokeShipmentFunction('superfrete-create-label',shipmentId)
export const syncSuperFreteShipment=(shipmentId:string)=>invokeShipmentFunction('superfrete-sync-shipment',shipmentId)

export type ShippingSettings={organization_id:string;sender_name:string|null;sender_document:string|null;sender_email:string|null;sender_phone:string|null;sender_postal_code:string|null;sender_address:string|null;sender_number:string|null;sender_complement:string|null;sender_district:string|null;sender_city:string|null;sender_state:string|null;default_weight:number|null;default_height:number|null;default_width:number|null;default_length:number|null;default_format:string;calculator_services:string}
export async function fetchShippingSettings(){const {organizationId}=await authenticatedOrganization();const {data,error}=await supabase!.from('organization_shipping_settings').select('*').eq('organization_id',organizationId).maybeSingle();if(error)throw new Error(error.message);return data as ShippingSettings|null}
export async function saveShippingSettings(input:Partial<ShippingSettings>){const {organizationId,user}=await currentOrganization();const {error}=await supabase!.from('organization_shipping_settings').upsert({...input,organization_id:organizationId,updated_by:user.id,updated_at:new Date().toISOString()});if(error)throw new Error(error.message)}

export async function askIntelligence(question:string,period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.functions.invoke('ask-intelligence',{body:{
    organization_id:organizationId,question,period_start:period.start,period_end:period.end,
  }})
  if(error){
    const response=(error as {context?:Response}).context
    let code='',runId=''
    try{const body=await response?.clone().json();code=String(body?.error?.code??'');runId=String(body?.error?.run_id??'')}catch{/* resposta sem JSON */}
    const messages:Record<string,string>={
      unauthorized:'Sua sessão expirou. Entre novamente para continuar.',
      rate_limit:'Muitas análises foram solicitadas. Aguarde um pouco.',
      OPENAI_AUTH_ERROR:'A conexão segura com a OpenAI precisa ser revisada.',
      OPENAI_MODEL_ERROR:'O modelo de inteligência configurado não está disponível.',
      OPENAI_RATE_LIMIT:'Muitas análises foram solicitadas. Aguarde um pouco.',
      OPENAI_TIMEOUT:'A análise demorou mais que o esperado. Tente novamente.',
      OPENAI_INVALID_RESPONSE:'Não conseguimos concluir esta análise agora.',
      OPENAI_MAX_OUTPUT_TOKENS:'A resposta ficou extensa demais. Vamos tentar novamente de forma resumida.',
      OPENAI_PROVIDER_ERROR:'Não conseguimos concluir esta análise agora.',
      OPENAI_SECRET_MISSING:'O serviço de inteligência ainda não está configurado.',
      AGGREGATE_QUERY_FAILED:'Não foi possível preparar os agregados comerciais.',
      ai_failed:'A OpenAI não conseguiu concluir a análise agora.',
      ai_timeout:'A análise excedeu o tempo esperado. Tente novamente.',
      ai_unavailable:'O serviço de inteligência não está configurado.',
      metrics_error:'Não foi possível preparar os agregados comerciais.',
      origin_forbidden:'Esta origem não está autorizada a acessar a inteligência.',
    }
    const support=runId?` Código de suporte: ${runId.slice(0,8)}.`:code?` Código: ${code}.`:''
    throw new Error((messages[code]??(response?'A inteligência retornou um erro interno.':'Falha de conexão com a inteligência.'))+support)
  }
  if(data?.error)throw new Error(data.error.message)
  return {answer:data.data as Record<string,unknown>,meta:data.meta as {run_id:string;status:string;retried:boolean;duration_ms:number}}
}

export type PerfumeCommercialSummary = {
  perfume_id:string; perfume_name:string; bottle_identifier:string|null
  total_ml:number; paid_ml:number; pending_ml:number; stock_ml:number; stock_items:number
  client_count:number; item_count:number; total_value:number; paid_value:number
  pending_value:number; sale_types:string[]; shipping_deadlines:string[]
  shipping_statuses:string[]; shipped_dates:string[]
}

export async function fetchPerfumeSummaries() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('perfume_commercial_summary', { org_id:organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as PerfumeCommercialSummary[]
}

export type ClientInput = {
  name: string; phone?: string; whatsappPhone?:string; email?: string; instagram?: string; cpf?: string;cnpj?:string
  birthDate?: string; postalCode?: string; address?: string; addressNumber?: string
  complement?: string; district?: string; city?: string; state?: string; notes?: string; status: string
}

export async function findPossibleClients(name: string) {
  const { organizationId } = await currentOrganization()
  const normalized = normalizeClient(name)
  const { data } = await supabase!.from('clients').select('id,name,normalized_name').eq('organization_id', organizationId).eq('normalized_name', normalized).limit(5)
  return data ?? []
}

export async function createClient(input: ClientInput) {
  const { user, organizationId } = await currentOrganization()
  const possible = await findPossibleClients(input.name)
  if (possible.length) throw new Error(`Possível duplicidade: já existe “${possible[0].name}”. Revise antes de salvar.`)
  const { data, error } = await supabase!.from('clients').insert({
    organization_id: organizationId, name: input.name.trim(), original_name: input.name.trim(),
    normalized_name: normalizeClient(input.name), phone: input.phone || null, whatsapp_phone:input.whatsappPhone||input.phone||null,email: input.email || null,
    instagram: input.instagram || null, cpf: input.cpf || null,cnpj:input.cnpj||null,birth_date: input.birthDate || null,
    postal_code: input.postalCode || null, address_line: input.address || null,
    address_number: input.addressNumber || null, complement: input.complement || null,
    district: input.district || null, city: input.city || null, state: input.state || null,
    notes: input.notes || null, status: input.status, source: 'manual', created_by: user.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateClient(clientId:string,input:ClientInput) {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.from('clients').update({
    name:input.name.trim(),normalized_name:normalizeClient(input.name),phone:input.phone||null,
    whatsapp_phone:input.whatsappPhone||input.phone||null,email:input.email||null,instagram:input.instagram||null,
    cpf:input.cpf||null,cnpj:input.cnpj||null,birth_date:input.birthDate||null,postal_code:input.postalCode||null,
    address_line:input.address||null,address_number:input.addressNumber||null,complement:input.complement||null,
    district:input.district||null,city:input.city||null,state:input.state||null,notes:input.notes||null,
    status:input.status,updated_at:new Date().toISOString(),
  }).eq('id',clientId).eq('organization_id',organizationId).select().single()
  if(error)throw new Error(error.message)
  return data
}

export type SaleInput = {
  clientId:string;date:string;amount:number;status:string;method:string;notes?:string
  shippingDeadlineRaw?:string;shippingDeadlineDate?:string;shippedAt?:string;saleType:'APC'|'SPLIT'
  volumeMl:number;perfume:string;paidAt?:string;creditReferenceAmount?:number|null
}
export async function createSale(input: SaleInput) {
  const { user, organizationId } = await currentOrganization()
  const normalizedPerfume=normalizeClient(input.perfume)
  let {data:perfume}=await supabase!.from('perfumes').select('id').eq('organization_id',organizationId).eq('normalized_name',normalizedPerfume).maybeSingle()
  if(!perfume){
    const bottle=input.perfume.match(/\((FRASCO\s*\d+)\)\s*$/i)?.[1]?.toUpperCase()??null
    const inserted=await supabase!.from('perfumes').insert({organization_id:organizationId,full_name_raw:input.perfume.trim(),normalized_name:normalizedPerfume,base_name:input.perfume.replace(/\s*\(FRASCO\s*\d+\)\s*$/i,'').trim(),bottle_identifier:bottle}).select('id').single()
    if(inserted.error)throw new Error(inserted.error.message)
    perfume=inserted.data
  }
  const { data, error } = await supabase!.from('sales').insert({
    organization_id: organizationId, client_id: input.clientId,perfume_id:perfume.id,sale_date: input.date,
    amount: input.amount, payment_status: input.status, payment_method: input.method,
    notes: input.notes || null, source: 'manual', data_quality_status: 'verified', created_by: user.id,
    perfume_name_raw:input.perfume.trim(),perfume_base_name:input.perfume.replace(/\s*\(FRASCO\s*\d+\)\s*$/i,'').trim(),
    sale_type:input.saleType,volume_ml:input.volumeMl,volume_ml_raw:String(input.volumeMl),
    shipping_deadline_raw:input.shippingDeadlineRaw||null,shipping_deadline_date:input.shippingDeadlineDate||null,
    shipping_operational_status:input.shippingDeadlineDate?null:input.shippingDeadlineRaw||null,
    shipped_at:input.shippedAt||null,paid_at:input.status==='pending'?null:input.paidAt||null,
    credit_reference_amount:input.creditReferenceAmount??null,inventory_allocation_eligible:true,
    operational_created_at:new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function searchClients(term: string) {
  const { organizationId } = await currentOrganization()
  const { data } = await supabase!.from('clients').select('id,name,phone,whatsapp_phone,email,cpf,postal_code,address_line,address_number,complement,district,city,state').eq('organization_id', organizationId).ilike('name', `%${term}%`).limit(8)
  return data ?? []
}

export type InventorySummary = {
  items:number;available_ml:number;healthy:number;low:number;critical:number
  out_of_stock:number;consumed_ml:number;movements:number
}
export type OperationalInventoryRow = {
  item_id:string;perfume_id:string;perfume:string;physical_ml:number;reserved_ml:number
  shipping_ml:number;available_ml:number;minimum_ml:number;reconciliation_status:string
}

export async function fetchOperationalInventory() {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('inventory_operational_rows',{org_id:organizationId})
  if(error)throw new Error(error.message)
  return (data??[]) as OperationalInventoryRow[]
}
export type InventoryRow = {
  item_id:string;perfume_id:string;perfume:string;available_ml:number;minimum_ml:number
  status:string;sold_ml:number;monthly_average:number;estimated_days:number|null;last_movement:string|null
}

export async function fetchInventory(period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const [summary,rows]=await Promise.all([
    supabase!.rpc('inventory_summary',{org_id:organizationId,start_date:period.start,end_date:period.end}),
    supabase!.rpc('inventory_rows',{org_id:organizationId,start_date:period.start,end_date:period.end}),
  ])
  if(summary.error)throw new Error(summary.error.message)
  if(rows.error)throw new Error(rows.error.message)
  return {summary:summary.data as InventorySummary,rows:(rows.data??[]) as InventoryRow[]}
}

export async function inventoryPerfumes() {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.from('perfumes').select('id,full_name_raw,normalized_name').eq('organization_id',organizationId).order('full_name_raw')
  if(error)throw new Error(error.message)
  return data??[]
}

export async function createInventoryItem(input:{perfumeId:string;openingMl:number;minimumMl:number;referenceDate:string;notes:string}) {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.rpc('inventory_create_item',{
    p_organization_id:organizationId,p_perfume_id:input.perfumeId,p_opening_ml:input.openingMl,
    p_minimum_ml:input.minimumMl,p_reference_date:input.referenceDate,p_notes:input.notes||null,
  })
  if(error)throw new Error(error.message)
  return data
}

export async function adjustInventory(itemId:string,quantity:number,reason:string,notes='') {
  const movementType=quantity>0?'entry':'negative_adjustment'
  const {data,error}=await supabase!.rpc('inventory_apply',{
    p_item_id:itemId,p_quantity_ml:quantity,p_type:movementType,p_reason:reason,p_notes:notes||null,p_sale_id:null,
  })
  if(error)throw new Error(error.message)
  return data
}
