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

export type DashboardActivityItem={id:string;kind:'activity'|'attention';message:string;created_at:string|null;href:string}
export async function fetchDashboardActivity(){
  const {organizationId}=await authenticatedOrganization(),start=new Date();start.setHours(0,0,0,0)
  const [sales,events,clients,shipments,stock]=await Promise.all([
    supabase!.from('sales').select('created_by,created_at').eq('organization_id',organizationId).gte('created_at',start.toISOString()).is('deleted_at',null),
    supabase!.from('shipment_events').select('id,shipment_id,event_type,actor_id,created_at').eq('organization_id',organizationId).in('event_type',['conference_assumed','conference_completed']).order('created_at',{ascending:false}).limit(5),
    supabase!.from('clients').select('id,cpf,cnpj,phone,whatsapp_phone,postal_code,address_line,address_number,district,city,state').eq('organization_id',organizationId).is('deleted_at',null),
    supabase!.from('shipments').select('id,status,superfrete_order_id,print_available,conference_owner_user_id').eq('organization_id',organizationId),
    supabase!.rpc('inventory_operational_rows',{org_id:organizationId}),
  ])
  const activeShipments=(shipments.data??[]).filter(s=>!['delivered','cancelled'].includes(s.status))
  const actorIds=[...new Set([...(sales.data??[]).map(x=>x.created_by),...(events.data??[]).map(x=>x.actor_id)].filter(Boolean))] as string[]
  const profiles=actorIds.length?await supabase!.from('profiles').select('id,full_name').in('id',actorIds):{data:[]}
  const names=new Map((profiles.data??[]).map(x=>[x.id,x.full_name||'Usuário RUAH'])),grouped=new Map<string,{count:number;last:string}>()
  for(const sale of sales.data??[]){const key=sale.created_by||'unknown',current=grouped.get(key);grouped.set(key,{count:(current?.count??0)+1,last:current?.last&&current.last>sale.created_at?current.last:sale.created_at})}
  const activity:DashboardActivityItem[]=[...grouped].map(([actor,value])=>({id:`sales-${actor}`,kind:'activity',message:`${names.get(actor)?`${names.get(actor)} registrou`:'Foram registradas'} ${value.count} ${value.count===1?'venda':'vendas'} hoje`,created_at:value.last,href:'/vendas'}))
  for(const event of events.data??[]){const owner=names.get(event.actor_id)||'Usuário RUAH';activity.push({id:`event-${event.id}`,kind:'activity',message:`${owner} ${event.event_type==='conference_completed'?'concluiu':'assumiu'} a conferência do Envio #${event.shipment_id.slice(0,8).toUpperCase()}`,created_at:event.created_at,href:`/entregas/${event.shipment_id}`})}
  const incomplete=(clients.data??[]).filter(c=>![c.cpf||c.cnpj,c.phone||c.whatsapp_phone,c.postal_code,c.address_line,c.address_number,c.district,c.city,c.state].every(Boolean)).length
  const values:[[number,string,string],[number,string,string],[number,string,string],[number,string,string]]=[
    [incomplete,'cadastro precisa completar dados para envio','cadastros precisam completar dados para envio'],
    [activeShipments.filter(s=>!s.conference_owner_user_id).length,'envio aguarda conferência','envios aguardam conferência'],
    [activeShipments.filter(s=>s.superfrete_order_id&&!s.print_available).length,'etiqueta aguarda arquivo para impressão','etiquetas aguardam arquivo para impressão'],
    [((stock.data??[]) as OperationalInventoryRow[]).filter(x=>Number(x.available_ml)<=Number(x.minimum_ml)).length,'perfume está com estoque baixo','perfumes estão com estoque baixo']]
  const hrefs=['/clientes','/entregas','/entregas','/estoque']
  const attention=values.map(([count,singular,plural],index)=>count?{id:`attention-${index}`,kind:'attention' as const,message:`${count} ${count===1?singular:plural}`,created_at:null,href:hrefs[index]}:null).filter(Boolean) as DashboardActivityItem[]
  return {activity:activity.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,6),attention}
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
  allocation_source:string;stock_managed:boolean;verified_at:string|null;verified_by:string|null;storage_location:string|null
}

export async function fetchClient360(clientId:string) {
  await authenticatedOrganization()
  const [{data:profile,error:profileError},{data:history,error:historyError},{data:waiting,error:waitingError},{data:shipments,error:shipmentsError}]=await Promise.all([
    supabase!.rpc('client_360',{p_client_id:clientId}),
    supabase!.from('sales').select('id,sale_date,amount,payment_status,payment_method,paid_at,perfume_name_raw,sale_type,volume_ml,notes,source,shipped_at,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))').eq('client_id',clientId).is('deleted_at',null).order('sale_date',{ascending:false}),
    supabase!.rpc('client_waiting_products_v2',{p_client_id:clientId}),
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

export type ClientPortalStatus={account_status:string|null;claim_email:string|null;verified_at:string|null;last_invited_at:string|null;sent_email_at:string|null;sent_whatsapp_at:string|null;invite_last_error:Record<string,string>|null;open_requests:number;open_tickets:number}
export async function fetchClientPortalStatus(clientId:string) {
  await currentOrganization()
  const {data,error}=await supabase!.rpc('client_portal_status',{p_client_id:clientId})
  if(error)throw new Error(error.message)
  const row=(data??[])[0]
  return (row??{account_status:null,claim_email:null,verified_at:null,last_invited_at:null,sent_email_at:null,sent_whatsapp_at:null,invite_last_error:null,open_requests:0,open_tickets:0}) as ClientPortalStatus
}

export type CustomerInviteResult={status:string;channels:{email:{status:string;error?:string;provider_message_id?:string};whatsapp:{status:string;error?:string}}}
export async function inviteCustomerAccount(clientId:string,email:string,channels={email:true,whatsapp:false}) {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.functions.invoke('customer-account-invite',{body:{organization_id:organizationId,client_id:clientId,email,channels_email:channels.email,channels_whatsapp:channels.whatsapp}})
  if(error){const response=(error as {context?:Response}).context;let message='Não foi possível enviar o acesso.';try{const body=await response?.clone().json();message=body?.error?.message??message}catch{/* resposta sem JSON */}throw new Error(message)}
  return data?.data as CustomerInviteResult
}
export type CustomerIdentityReview={id:string;request_id:string;full_name:string;email:string;phone:string;reason:string;candidate_client_ids:string[];created_at:string}
export async function fetchCustomerIdentityReviews(){await currentOrganization();const{data,error}=await supabase!.rpc('customer_identity_reviews_list');if(error)throw new Error(error.message);return(data??[])as CustomerIdentityReview[]}
export async function decideCustomerIdentityReview(reviewId:string,action:'link'|'create'|'reject',clientId?:string){await currentOrganization();const{error}=await supabase!.rpc('customer_identity_review_decide',{p_review_id:reviewId,p_action:action,p_client_id:clientId??null});if(error)throw new Error(error.message)}

export type CommercialSale = {
  id:string; client_id:string|null; perfume_id?:string|null; sale_date:string|null; amount:number; payment_status:string
  payment_method:string|null; paid_at:string|null; original_client:string|null
  perfume_name_raw:string|null; bottle_identifier:string|null; sale_type:string|null
  volume_ml:number|null; shipping_deadline_raw:string|null;shipping_deadline_date:string|null
  shipping_operational_status:string|null; shipped_at:string|null; notes:string|null;source:string
  credit_reference_amount?:number|null;inventory_allocation_eligible?:boolean
  clients:{name:string;phone?:string|null;whatsapp_phone?:string|null;email?:string|null;cpf?:string|null;cnpj?:string|null;postal_code?:string|null;address_line?:string|null;address_number?:string|null;complement?:string|null;district?:string|null;city?:string|null;state?:string|null}|null
  inventory_allocations?:{id:string;status:string;quantity_ml:number;shipment_id:string|null;allocation_source:string;stock_managed:boolean;verified_at:string|null;verified_by:string|null;verification_note:string|null;storage_location:string|null;inventory_items:{id:string;physical_ml:number;available_ml:number}|null}[]
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
  const {data,error}=await supabase!.from('sales').select('id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,credit_reference_amount,inventory_allocation_eligible,clients(name,phone,whatsapp_phone,email,cpf,cnpj,postal_code,address_line,address_number,complement,district,city,state)').eq('organization_id',organizationId).eq('id',saleId).is('deleted_at',null).single()
  if(error)throw new Error(error.message)
  const [allocations,shipments]=await Promise.allSettled([
    supabase!.from('inventory_allocations').select('id,status,quantity_ml,shipment_id,allocation_source,stock_managed,verified_at,verified_by,verification_note,storage_location,inventory_items(id,physical_ml,available_ml)').eq('sale_id',saleId),
    supabase!.from('shipment_items').select('shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at)').eq('sale_id',saleId).is('removed_at',null),
  ])
  return {...data,inventory_allocations:allocations.status==='fulfilled'&&!allocations.value.error?allocations.value.data??[]:[],shipment_items:shipments.status==='fulfilled'&&!shipments.value.error?shipments.value.data??[]:[]} as unknown as CommercialSale
}

export async function confirmLegacyProductCustody(saleId:string,storageLocation:string,note:string){await currentOrganization();const {data,error}=await supabase!.rpc('confirm_legacy_product_custody',{p_sale_id:saleId,p_storage_location:storageLocation||null,p_verification_note:note||null});if(error)throw new Error(error.message);return data}
export async function releaseLegacyProductCustody(allocationId:string){await currentOrganization();const {data,error}=await supabase!.rpc('release_legacy_product_custody',{p_allocation_id:allocationId});if(error)throw new Error(error.message);return data}

export type ReservedAllocation={id:string;client_id:string;sale_id:string;quantity_ml:number;allocated_at:string;allocation_source:string;stock_managed:boolean;storage_location:string|null;clients:{name:string}|null;sales:{sale_date:string|null;amount:number;perfume_name_raw:string|null;sale_type:string|null}|null}
export async function fetchReservedAllocations(){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('inventory_allocations').select('id,client_id,sale_id,quantity_ml,allocated_at,allocation_source,stock_managed,storage_location,clients(name),sales(sale_date,amount,perfume_name_raw,sale_type)').eq('organization_id',organizationId).eq('status','reserved').order('allocated_at',{ascending:true})
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
  print_available:boolean;print_http_status:number|null;print_content_type:string|null;print_checked_at:string|null
  conference_owner_user_id:string|null;conference_owner_name_snapshot:string|null;conference_started_at:string|null;conference_completed_at:string|null
  clients:{name:string;updated_at?:string;phone?:string|null;whatsapp_phone?:string|null;cpf?:string|null;cnpj?:string|null;postal_code?:string|null;address_line?:string|null;address_number?:string|null;complement?:string|null;district?:string|null;city?:string|null;state?:string|null}|null;shipment_quotes:ShipmentQuote[];shipment_items:{allocation_id:string;quantity_ml:number;separated_at:string|null;checked_at:string|null;divergence_note:string|null;bottle_id:string|null;split_unit_id:string|null;inventory_allocations:{allocation_source:string;stock_managed:boolean;inventory_items:{bottle_tracking_status:string}|null}|null;inventory_bottles:{bottle_code:string;bottle_label:string;physical_ml:number}|null;inventory_split_units:{split_code:string;quantity_ml:number;status:string}|null;sales:{id:string;amount:number;perfume_name_raw:string|null;sale_type:string|null;shipping_deadline_date:string|null}|null}[]
  shipment_events?:{id:number;event_type:string;from_status:string|null;to_status:string|null;metadata:Record<string,unknown>;created_at:string}[]
}

const SHIPMENT_ITEMS_SELECT='shipment_items(allocation_id,quantity_ml,separated_at,checked_at,divergence_note,bottle_id,split_unit_id,inventory_allocations(allocation_source,stock_managed,inventory_items(bottle_tracking_status)),inventory_bottles(bottle_code,bottle_label,physical_ml),inventory_split_units(split_code,quantity_ml,status),sales(id,amount,perfume_name_raw,sale_type,shipping_deadline_date))'

export async function fetchOperationalShipments(){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select(`*,clients(name),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),${SHIPMENT_ITEMS_SELECT}`).eq('organization_id',organizationId).order('created_at',{ascending:false})
  if(error)throw new Error(error.message)
  return (data??[]) as unknown as OperationalShipment[]
}
export async function fetchShipment360(shipmentId:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select(`*,clients(name,updated_at,phone,whatsapp_phone,cpf,cnpj,postal_code,address_line,address_number,complement,district,city,state),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),${SHIPMENT_ITEMS_SELECT},shipment_events(id,event_type,from_status,to_status,metadata,created_at)`).eq('organization_id',organizationId).eq('id',shipmentId).order('created_at',{referencedTable:'shipment_events',ascending:false}).single()
  if(error)throw new Error(error.message)
  return data as unknown as OperationalShipment
}
export async function updateShipmentItemCheck(shipmentId:string,allocationId:string,separated:boolean,checked:boolean,divergenceNote:string){await currentOrganization();const {error}=await supabase!.rpc('update_shipment_item_check',{p_shipment_id:shipmentId,p_allocation_id:allocationId,p_separated:separated,p_checked:checked,p_divergence_note:divergenceNote||null});if(error)throw new Error(error.message)}
export type BottleScanResult={ok:true;kind:'bottle';bottle_id:string;bottle_code:string;bottle_label:string;physical_ml:number;needed_ml:number}
  |{ok:true;kind:'split';split_unit_id:string;split_code:string;quantity_ml:number;needed_ml:number}
  |{ok:false;reason:'not_bottle_tracked'|'bottle_not_found'|'wrong_perfume'|'bottle_unavailable'|'insufficient_ml'|'bottle_already_assigned'|'split_unavailable'|'split_quantity_mismatch'|'split_already_assigned';bottle_label?:string;bottle_code?:string;split_code?:string;status?:string;available_ml?:number;needed_ml?:number;split_ml?:number}
export async function scanShipmentItemBottle(shipmentId:string,allocationId:string,scanValue:string){await currentOrganization();const {data,error}=await supabase!.rpc('shipment_item_scan_bottle',{p_shipment_id:shipmentId,p_allocation_id:allocationId,p_scan_value:scanValue});if(error)throw new Error(error.message);return data as BottleScanResult}
export async function assumeShipmentConference(shipmentId:string){await currentOrganization();const {data,error}=await supabase!.rpc('assume_shipment_conference',{p_shipment_id:shipmentId});if(error)throw new Error(error.message);return data as OperationalShipment}
export async function updateShipmentShippingData(shipmentId:string,data:Record<string,unknown>){await currentOrganization();const {data:shipment,error}=await supabase!.rpc('update_shipment_shipping_data',{p_shipment_id:shipmentId,p_data:data});if(error)throw new Error(error.message);return shipment as OperationalShipment}
export async function refreshShipmentRecipient(shipmentId:string){await currentOrganization();const {data,error}=await supabase!.rpc('refresh_shipment_recipient',{p_shipment_id:shipmentId});if(error)throw new Error(error.message);return data as OperationalShipment}
export async function selectShipmentQuote(shipmentId:string,quoteId:string){await currentOrganization();const {error}=await supabase!.rpc('select_shipment_quote',{p_shipment_id:shipmentId,p_quote_id:quoteId});if(error)throw new Error(error.message)}
export async function approveShipmentForLabel(shipmentId:string){await currentOrganization();const {error}=await supabase!.rpc('approve_shipment_for_label',{p_shipment_id:shipmentId});if(error)throw new Error(error.message)}

async function invokeShipmentFunction(name:string,shipmentId:string,extra:Record<string,unknown>={}){
  const {organizationId}=await currentOrganization(),{data,error}=await supabase!.functions.invoke(name,{body:{organization_id:organizationId,shipment_id:shipmentId,...extra}})
  if(error){const response=(error as {context?:Response}).context;let message='Não foi possível concluir a operação com a SuperFrete.';try{const body=await response?.clone().json();message=body?.error?.message??message}catch{/* resposta sem JSON */}const reference=response?.headers.get('x-request-id');throw new Error(`${message}${reference?` Referência: ${reference}.`:''}`)}
  return data?.data
}
export const quoteShipment=(shipmentId:string)=>invokeShipmentFunction('superfrete-quote',shipmentId)
export const createSuperFreteCart=(shipmentId:string)=>invokeShipmentFunction('superfrete-create-label',shipmentId,{action:'cart'})
export const checkoutSuperFreteLabel=(shipmentId:string)=>invokeShipmentFunction('superfrete-create-label',shipmentId,{action:'checkout'})
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
export async function parseSaleAssistant(text:string){const {data,error}=await supabase!.functions.invoke('parse-sale-assistant',{body:{text}});if(error)throw new Error('Não foi possível interpretar a anotação agora.');if(data?.error)throw new Error(data.error.message);return data.data as {fields:Record<string,unknown>;client_matches:Array<Record<string,unknown>>;perfume_matches:Array<{id:string;name:string;available_ml:number}>}}

export type AiSalesBatchSale={client_name:string;perfume_name?:string;sale_type:'APC'|'SPLIT';volume_ml:number;amount:number;client_match_status:'found'|'new'|'review';client_id:string|null;client:Record<string,unknown>|null;suggestions:{id:string;name:string;missing_shipping_fields:string[]}[];missing_shipping_fields:string[];possible_duplicate:boolean;payment_status_raw?:string|null}
export type AiSalesBatchGroup={perfume:string;raw_perfume_name:string;normalized_perfume_name:string;display_name:string;brand:string|null;bottle_number:number|null;inventory_item_id:string|null;perfume_id:string|null;perfume_match_status:'found'|'review'|'new';perfume_matches:{id:string;full_name_raw:string}[];inventory:Record<string,unknown>|null;sales:AiSalesBatchSale[];availability_rows:number;availability_ml?:number;availability_amount?:number;totals:{sales:number;volume_ml:number;amount:number}}
export type AiSalesBatchPreview={source_format?:'whatsapp'|'tsv';groups?:AiSalesBatchGroup[];availability_rows?:number;availability_ml?:number;availability_amount?:number;perfume:string;raw_perfume_name?:string;normalized_perfume_name?:string;display_name?:string;brand?:string|null;bottle_number:number|null;original_volume_ml:number|null;quote_per_ml:number|null;recrimping_fee:number|null;apc_volume_ml:number|null;apc_extra:number|null;deadline_raw:string|null;deadline_day_month:string|null;shipping_deadline_date:string|null;business_days:number|null;announced_balance_ml:number|null;sale_date:string;fingerprint:string;duplicate_batch:Record<string,unknown>|null;perfume_match_status:'found'|'review'|'new';perfume_id:string|null;inventory_item_id:string|null;perfume_matches:{id:string;full_name_raw:string}[];inventory:Record<string,unknown>|null;sales:AiSalesBatchSale[];totals:{sales:number;volume_ml:number;amount:number;calculated_balance_ml:number|null;volume_consistent:boolean};summary:{clients:number;found:number;new:number;review:number;shipping_ready:number;shipping_incomplete:number};raw_text:string}
export type AiSalesBatchMultiResult={batch_id:string;sales_created:number;clients_created:number;clients_existing:number;perfumes_processed:number;perfumes_matched:number;inventory_items_bootstrapped:number;total_ml_sold:number;total_amount_sold:number;commercial_remaining_ml:number;commercial_remaining_amount:number;shipping_incomplete:number;paid_source_count:number;awaiting_source_count:number;unstated_payment_count:number;idempotent:boolean}
export async function parseSalesBatch(text:string,saleDate:string){const {organizationId}=await authenticatedOrganization();const {data,error}=await supabase!.functions.invoke('parse-sales-batch',{body:{organization_id:organizationId,text,sale_date:saleDate}});if(error){let message='Não foi possível analisar esta lista. Tente novamente.';try{const body=await (error as {context?:Response}).context?.clone().json(),code=String(body?.error?.code??'');if(code==='unauthorized')message='Sua sessão expirou. Entre novamente.';else if(code==='sales_unrecognized')message='Encontramos possíveis vendas, mas algumas linhas precisam de revisão.';else if(code==='sales_missing')message='Nenhuma linha de venda foi reconhecida. Confira o formato da lista.';else if(['invalid_org','no_organization','organization_required','forbidden','organization_lookup_failed'].includes(code))message='Não foi possível identificar sua empresa. Atualize a página e tente novamente.'}catch{/* resposta não JSON */}throw new Error(message)}return data.data as AiSalesBatchPreview}
// Known business-rule errors raised by the AI import RPCs get a message the
// operator can act on. Anything else (an unexpected/technical database
// error — e.g. a missing-function error from a misconfigured extension
// schema) NEVER reaches the operator verbatim: it falls back to a generic,
// safe message, and the raw detail goes to console.error only, for support.
const AI_IMPORT_ERROR_MESSAGES: Record<string,string> = {
  perfume_resolution_ambiguous: 'Encontramos mais de um cadastro para este perfume. Escolha o registro correto antes de continuar.',
  inventory_resolution_ambiguous: 'Encontramos mais de um item de estoque compatível. Selecione manualmente o item correto.',
  perfume_selection_incompatible: 'A seleção de perfume não é válida para este lote. Atualize a análise e tente novamente.',
  invalid_perfume_selection: 'A seleção de perfume não é válida para este lote. Atualize a análise e tente novamente.',
  multi_perfume_batch_not_supported: 'Esta lista tem mais de um perfume e precisa ser confirmada pelo fluxo de importação em lote.',
  client_resolution_required: 'Confirme quem é o cliente de cada venda antes de continuar.',
  client_resolution_ambiguous: 'Encontramos mais de um cliente com esse nome. Selecione manualmente o cliente correto.',
  invalid_client: 'Não foi possível vincular um dos clientes desta lista. Atualize a análise e tente novamente.',
  inventory_resolution_required: 'Resolva o perfume no estoque de todos os grupos antes de continuar.',
  sales_required: 'Nenhuma venda válida foi encontrada nesta lista.',
  groups_required: 'Nenhum grupo de perfume válido foi encontrado nesta lista.',
  forbidden: 'Seu perfil não tem permissão para confirmar esta importação.',
}
function friendlyAiImportError(raw:string):Error{
  const code=Object.keys(AI_IMPORT_ERROR_MESSAGES).find(key=>raw.includes(key))
  if(code)return new Error(AI_IMPORT_ERROR_MESSAGES[code])
  console.error('ai_import_technical_error',raw)
  return new Error('Não foi possível concluir a importação. Nenhuma venda foi criada.')
}
export async function confirmAiSalesBatch(preview:AiSalesBatchPreview){const {organizationId}=await currentOrganization();if(!preview.inventory_item_id)throw new Error('Selecione um item real do estoque.');const validation=await supabase!.rpc('validate_ai_batch_inventory',{p_organization_id:organizationId,p_inventory_item_id:preview.inventory_item_id});if(validation.error)throw friendlyAiImportError(validation.error.message);const secured={...preview,perfume_id:validation.data};const {data,error}=await supabase!.rpc('confirm_ai_sales_batch',{p_organization_id:organizationId,p_fingerprint:preview.fingerprint,p_source_text:preview.raw_text,p_batch:secured});if(error)throw friendlyAiImportError(error.message);return data as {batch_id:string;sales_created:number;clients_created:number;shipping_incomplete:number;idempotent:boolean}}
export type PerfumeResolutionCandidate={perfume_id:string;name:string;brand:string|null;bottle_identifier:string|null;inventory_item_id:string|null;reconciliation_status:string|null}
export type BootstrapAiBatchInventoryResult={resolution_status:'resolved'|'idempotent'|'ambiguous';inventory_item_id:string|null;perfume_id:string|null;created:boolean;idempotent:boolean;bootstrap_ml:number;reconciliation_status?:string;candidates?:PerfumeResolutionCandidate[]}
export async function bootstrapAiBatchInventory(input:{fingerprint:string;rawPerfumeName:string;brand:string|null;bottleNumber:number|null;referenceDate:string;sales:AiSalesBatchSale[];selectedPerfumeId?:string|null}){
  const {organizationId}=await currentOrganization()
  const base={p_organization_id:organizationId,p_fingerprint:input.fingerprint,p_raw_perfume_name:input.rawPerfumeName,p_brand:input.brand,p_bottle_number:input.bottleNumber,p_reference_date:input.referenceDate,p_sales:input.sales}
  // Two distinctly-named RPCs, never an overload of one another: PostgREST
  // must never have to disambiguate between candidate function signatures.
  const {data,error}=input.selectedPerfumeId
    ?await supabase!.rpc('bootstrap_ai_batch_inventory_resolved',{...base,p_selected_perfume_id:input.selectedPerfumeId})
    :await supabase!.rpc('bootstrap_ai_batch_inventory',base)
  if(error)throw friendlyAiImportError(error.message)
  return data as BootstrapAiBatchInventoryResult
}
export async function confirmAiSalesBatchMulti(preview:AiSalesBatchPreview){
  const {organizationId}=await currentOrganization()
  const groups=(preview.groups??[]).map(group=>({perfume:group.perfume,display_name:group.display_name,inventory_item_id:group.inventory_item_id,availability_ml:group.availability_ml??0,availability_amount:group.availability_amount??0,sales:group.sales}))
  const {data,error}=await supabase!.rpc('confirm_ai_sales_batch_multi',{p_organization_id:organizationId,p_fingerprint:preview.fingerprint,p_source_text:preview.raw_text,p_sale_date:preview.sale_date,p_shipping_deadline_date:preview.shipping_deadline_date,p_deadline_raw:preview.deadline_raw,p_groups:groups})
  if(error)throw friendlyAiImportError(error.message)
  return data as AiSalesBatchMultiResult
}
// Sends only pre-formatted, human-readable Portuguese sentences — never raw
// field names or a JSON blob of aggregates — so the model has nothing
// code-shaped available to echo back into its paraphrase.
export async function summarizeAiBatchImport(sentences:string[]){
  if(!sentences.length)return null
  try{
    const {organizationId}=await currentOrganization()
    const {data,error}=await supabase!.functions.invoke('summarize-ai-batch-import',{body:{organization_id:organizationId,sentences}})
    if(error||data?.error)return null
    return String(data?.data?.summary??'')||null
  }catch{return null}
}

export async function searchClients(term: string) {
  const { organizationId } = await currentOrganization()
  const normalized=normalizeClient(term)
  if(normalized.length<2)return[]
  const { data,error } = await supabase!.from('clients').select('id,name,phone,whatsapp_phone,email,cpf,postal_code,address_line,address_number,complement,district,city,state').eq('organization_id', organizationId).is('deleted_at',null).is('merged_into_id',null).eq('status','active').gte('normalized_name',normalized).lt('normalized_name',`${normalized}\uffff`).order('normalized_name').limit(12)
  if(error)throw new Error(error.message)
  return data ?? []
}

export async function searchPerfumes(term:string){
  const {organizationId}=await currentOrganization(),normalized=normalizeClient(term)
  if(normalized.length<2)return[]
  const {data,error}=await supabase!.from('perfumes').select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier').eq('organization_id',organizationId).gte('normalized_name',normalized).lt('normalized_name',`${normalized}\uffff`).order('normalized_name').limit(12)
  if(error)throw new Error(error.message)
  return data??[]
}

export type InventorySummary = {
  items:number;available_ml:number;healthy:number;low:number;critical:number
  out_of_stock:number;consumed_ml:number;movements:number
}
export type OperationalInventoryRow = {
  item_id:string;perfume_id:string;perfume:string;physical_ml:number;reserved_ml:number
  shipping_ml:number;available_ml:number;minimum_ml:number;reconciliation_status:string
  average_cost_per_ml:number|null
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
