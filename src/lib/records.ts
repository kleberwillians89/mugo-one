import { normalizeClient } from './importer'
import { supabase } from './supabase'
import type { PeriodValue } from './period'
import { OPERATIONAL_START_DATE, operationalPeriod, withOperationalDaviFilters } from './operational-sales'

export async function authenticatedOrganization() {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para continuar.')
  const { data, error } = await supabase.from('organization_members')
    .select('organization_id,role').eq('user_id', user.id).limit(1).single()
  if (error || !data) throw new Error('Usuário sem organização vinculada.')
  return { user, organizationId: data.organization_id as string, role: data.role as string }
}

export async function fetchOperationalSalesStartDate(organizationId:string) {
  const{data,error}=await supabase!.from('organizations').select('operational_sales_start_date').eq('id',organizationId).single()
  if(error)throw new Error(error.message)
  return(data?.operational_sales_start_date as string|null)??OPERATIONAL_START_DATE
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
  const operational=operationalPeriod(period)
  const {data,error}=await supabase!.rpc('commercial_period_summary',{
    org_id:organizationId,start_date:operational.start,end_date:operational.end,
  })
  if(error)throw new Error(error.message)
  return data as PeriodSummary
}

export type DashboardActivityItem={id:string;kind:'activity'|'attention';message:string;created_at:string|null;href:string}
export async function fetchDashboardActivity(){
  const {organizationId}=await authenticatedOrganization(),start=new Date();start.setHours(0,0,0,0)
  const [sales,events,clients,shipments,stock]=await Promise.all([
    supabase!.from('sales').select('created_by,created_at,sale_date').eq('organization_id',organizationId).gte('created_at',start.toISOString()).gte('sale_date',OPERATIONAL_START_DATE).is('deleted_at',null),
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
  const [{data,error},{data:numbers,error:numbersError}]=await Promise.all([
    supabase!.rpc('client_period_summary',{
      org_id:organizationId,start_date:period.start,end_date:period.end,
    }),
    supabase!.from('clients').select('id,client_number,has_gift').eq('organization_id',organizationId).is('deleted_at',null),
  ])
  if(error)throw new Error(error.message)
  if(numbersError)throw new Error(numbersError.message)
  const byId=new Map((numbers??[]).map((row:{id:string;client_number:number|null;has_gift:boolean})=>[String(row.id),row]))
  return ((data ?? []) as Record<string,unknown>[]).map((row)=>{
    const extra=byId.get(String(row.client_id))
    return {...row,client_number:extra?.client_number??null,has_gift:extra?.has_gift??false}
  })
}

export type Client360 = {
  client:{id:string;client_number:number|null;name:string;phone:string|null;whatsapp_phone:string|null;email:string|null;cpf:string|null;cnpj:string|null;instagram:string|null;birth_date:string|null;postal_code:string|null;address_line:string|null;address_number:string|null;complement:string|null;district:string|null;city:string|null;state:string|null;notes:string|null;status:string;source:string;registration_origin:string|null;has_gift:boolean;gift_notes:string|null;created_at:string;updated_at:string}
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
    supabase!.from('sales').select('id,updated_at,sale_date,amount,payment_status,payment_method,paid_at,perfume_name_raw,bottle_identifier,sale_type,volume_ml,notes,source,shipped_at,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,legacy_shipping_status,legacy_shipping_status_updated_at,legacy_shipping_status_updated_by,legacy_shipping_confirmation,legacy_shipping_date,legacy_shipping_confirmed_at,legacy_shipping_confirmed_by,shipment_items(removed_at,shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))').eq('client_id',clientId).is('deleted_at',null).order('sale_date',{ascending:false}),
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
export type ManychatMessageType='collection'|'access'
export async function sendManychatMessage(clientId:string,messageType:ManychatMessageType){
  await currentOrganization()
  const{data,error}=await supabase!.functions.invoke('manychat-send',{body:{client_id:clientId,message_type:messageType}})
  if(error){const response=(error as{context?:Response}).context;let message='Não foi possível enviar o WhatsApp.';try{const body=await response?.clone().json();message=body?.error?.message??message}catch{/* resposta sem JSON */}throw new Error(message)}
  return data?.data as{status:'sent';message_type:ManychatMessageType}
}
export type CustomerIdentityReview={id:string;request_id:string;full_name:string;email:string;phone:string;reason:string;candidate_client_ids:string[];created_at:string}
export async function fetchCustomerIdentityReviews(){await currentOrganization();const{data,error}=await supabase!.rpc('customer_identity_reviews_list');if(error)throw new Error(error.message);return(data??[])as CustomerIdentityReview[]}
export async function decideCustomerIdentityReview(reviewId:string,action:'link'|'create'|'reject',clientId?:string){await currentOrganization();const{error}=await supabase!.rpc('customer_identity_review_decide',{p_review_id:reviewId,p_action:action,p_client_id:clientId??null});if(error)throw new Error(error.message)}

export type CommercialSale = {
  id:string; client_id:string|null; perfume_id?:string|null; sale_date:string|null; amount:number; payment_status:string; updated_at:string
  payment_method:string|null; paid_at:string|null; original_client:string|null
  perfume_name_raw:string|null; bottle_identifier:string|null; sale_type:string|null
  volume_ml:number|null; shipping_deadline_raw:string|null;shipping_deadline_date:string|null;shipping_availability_text?:string|null;shipping_availability_kind?:string|null;shipping_available_date?:string|null;shipping_lead_business_days?:number|null;shipping_availability_confirmed_at?:string|null
  shipping_operational_status:string|null; shipped_at:string|null; notes:string|null;source:string
  legacy_shipping_confirmation?:'pending'|'sent'|'not_sent'|null;legacy_shipping_date?:string|null;legacy_shipping_confirmed_at?:string|null;legacy_shipping_confirmed_by?:string|null
  legacy_shipping_status?:'confirmed'|'to_send'|'out_of_stock'|null;legacy_shipping_status_updated_at?:string|null;legacy_shipping_status_updated_by?:string|null
  credit_reference_amount?:number|null;inventory_allocation_eligible?:boolean
  clients:{name:string;phone?:string|null;whatsapp_phone?:string|null;email?:string|null;cpf?:string|null;cnpj?:string|null;postal_code?:string|null;address_line?:string|null;address_number?:string|null;complement?:string|null;district?:string|null;city?:string|null;state?:string|null}|null
  inventory_allocations?:{id:string;status:string;quantity_ml:number;shipment_id:string|null;allocation_source:string;stock_managed:boolean;verified_at:string|null;verified_by:string|null;verification_note:string|null;storage_location:string|null;inventory_items:{id:string;physical_ml:number;available_ml:number}|null}[]
  shipment_items?:{shipment_id:string;shipments:{id:string;status:string;carrier:string|null;service:string|null;tracking_code:string|null;posted_at:string|null;delivered_at:string|null}|null}[]
}

export type SaleFilters = {
  period?:PeriodValue; paymentStart?:string;paymentEnd?:string;shippingStart?:string;shippingEnd?:string
  search?:string;client?:string;perfume?:string;bottle?:string;type?:string;status?:string;method?:string
  origin?:string;volumeMl?:number;minValue?:number;maxValue?:number;delivery?:string;sort?:string
}

export type DaviExcelRow={id:string;client_id:string;client_number:number|null;client_name:string;has_gift:boolean;sale_date:string;shipping_deadline_display:string|null;shipped_at:string|null;sale_type:string|null;volume_ml:number|null;perfume_name:string|null;bottle_identifier:string|null;split_completed_at:string|null;amount:number;payment_status:string;payment_method:string|null;paid_at:string|null;credit_reference_amount:number|null;notes:string|null;operational_status:string;attachment_count:number}
export type DaviExcelSaleEdit={id:string;client_id:string;perfume_id:string;sale_date:string;shipping_deadline_date:string|null;shipping_deadline_raw:string|null;shipped_at:string|null;sale_type:string|null;volume_ml:number|null;bottle_identifier:string|null;split_completed_at:string|null;amount:number;payment_status:string;payment_method:string|null;paid_at:string|null;credit_reference_amount:number|null;notes:string|null;updated_at:string;clients:{name:string}|null;perfumes:{full_name_raw:string;brand_house:string|null}|null;inventory_allocations:{id:string}|null;shipment_items:{shipment_id:string;shipments:{status:string}|null}[]|null}
export type DaviFilterKind='text'|'date'|'number'
export type DaviColumnFilter={values?:string[];condition?:{operator:string;value?:string;value2?:string}}
export type DaviExcelFilters={search?:string;attachment?:'all'|'with'|'without';split?:'all'|'completed'|'pending';gift?:'all'|'with'|'without';columns?:Record<string,DaviColumnFilter>}
export type DaviDistinctValue={value:string;count:number}
export type DaviSortLevel={column:string;direction:'asc'|'desc'}
export const DAVI_OPERATIONAL_SORT:DaviSortLevel[]=[{column:'sale_date',direction:'asc'},{column:'perfume',direction:'asc'},{column:'type',direction:'asc'},{column:'volume',direction:'desc'}]
export async function fetchDaviExcel(filters:DaviExcelFilters,page=0,pageSize=100,sorts:DaviSortLevel[]=DAVI_OPERATIONAL_SORT){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('davi_excel_list_multi',{p_filters:withOperationalDaviFilters(filters),p_page:page,p_page_size:pageSize,p_sorts:sorts})
  if(error)throw new Error(error.message)
  const result=data as {rows:DaviExcelRow[];total:number}|null
  return result??{rows:[],total:0}
}
export async function fetchDaviExcelSaleEdit(saleId:string){
  const{organizationId}=await authenticatedOrganization()
  const{data,error}=await supabase!.from('sales').select('id,client_id,perfume_id,sale_date,shipping_deadline_date,shipping_deadline_raw,shipped_at,sale_type,volume_ml,bottle_identifier,split_completed_at,amount,payment_status,payment_method,paid_at,credit_reference_amount,notes,updated_at,clients(name),perfumes(full_name_raw,brand_house),inventory_allocations(id),shipment_items(shipment_id,shipments(status))').eq('organization_id',organizationId).eq('id',saleId).single()
  if(error)throw new Error(error.message)
  return data as unknown as DaviExcelSaleEdit
}
export async function updateDaviExcelSale(saleId:string,patch:Record<string,unknown>,expectedUpdatedAt:string,confirmOperational=false){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('davi_excel_update_sale_with_bottle',{p_sale_id:saleId,p_patch:patch,p_expected_updated_at:expectedUpdatedAt,p_confirm_operational:confirmOperational})
  if(error)throw new Error(error.message)
  return data as{ id:string;updated_at:string;changed_fields:string[];shipment_snapshot_preserved:boolean }
}
export type DaviSaleDeleteReason='duplicate_sale'|'incorrect_entry'|'customer_cancelled'|'import_error'|'other'
export async function softDeleteDaviSale(saleId:string,expectedUpdatedAt:string,reason:DaviSaleDeleteReason,note?:string){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('soft_delete_davi_sale',{p_sale_id:saleId,p_expected_updated_at:expectedUpdatedAt,p_reason:reason,p_note:note||null})
  if(error){
    const message=String(error.message)
    if(message.includes('stale_sale'))throw new Error('Esta venda foi atualizada por outra pessoa. Recarregue antes de excluir.')
    if(message.includes('sale_has_operational_dependency')||message.includes('sale_has_active_shipment_allocation')||message.includes('sale_has_manual_verified_allocation'))throw new Error('Esta venda já possui movimentação operacional e não pode ser excluída diretamente.')
    throw new Error(message)
  }
  return data as{id:string;idempotent:boolean;deleted_at:string;released_allocation:boolean}
}
export async function fetchDaviExcelDistinct(column:string,filters:DaviExcelFilters,search='',offset=0,limit=200){
  await authenticatedOrganization()
  const operationalFilters=withOperationalDaviFilters(filters)
  const{data,error}=await supabase!.rpc('davi_excel_distinct',{p_column:column,p_filters:operationalFilters,p_search:search,p_offset:column==='sale_date'?0:offset,p_limit:column==='sale_date'?250:limit})
  if(error)throw new Error(error.message)
  const result=(data??{values:[],total:0,has_more:false})as{values:DaviDistinctValue[];total:number;has_more:boolean}
  if(column!=='sale_date')return result
  const operationalValues=result.values.filter(item=>item.value!=='__BLANK__'&&item.value>=OPERATIONAL_START_DATE)
  return{values:operationalValues.slice(offset,offset+limit),total:operationalValues.length,has_more:offset+limit<operationalValues.length}
}
export async function setClientGift(clientId:string,hasGift:boolean,giftNotes:string|null,expectedUpdatedAt?:string){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('davi_excel_set_client_gift',{p_client_id:clientId,p_has_gift:hasGift,p_gift_notes:giftNotes,p_expected_updated_at:expectedUpdatedAt??null})
  if(error){
    const message=String(error.message)
    if(message.includes('stale_client'))throw new Error('Este cliente foi atualizado por outra pessoa. Recarregue antes de salvar.')
    if(message.includes('forbidden'))throw new Error('Você não tem permissão para editar clientes.')
    if(message.includes('client_not_found'))throw new Error('Cliente não encontrado nesta organização.')
    throw new Error(message)
  }
  return data as{id:string;has_gift:boolean;gift_notes:string|null;updated_at:string;changed:boolean}
}

export type CollectionSaleRow={id:string;client_id:string;client_number:number|null;client_name:string;sale_date:string;perfume_name:string|null;perfume_brand:string|null;sale_type:string|null;volume_ml:number|null;amount:number;payment_status:string;last_message_copied_at:string|null;message_copied_count:number}
export async function fetchCollectionsPending(search=''){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('collections_pending_sales',{p_search:search||null})
  if(error)throw new Error(error.message)
  return(data??[])as CollectionSaleRow[]
}
export async function logCollectionMessageCopied(clientId:string,metadata:Record<string,unknown>={}){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('collections_log_message_copied',{p_client_id:clientId,p_metadata:metadata})
  if(error){
    const message=String(error.message)
    if(message.includes('forbidden'))throw new Error('Você não tem permissão para visualizar cobranças.')
    if(message.includes('client_not_found'))throw new Error('Cliente não encontrado nesta organização.')
    throw new Error(message)
  }
  return data as{id:string;client_id:string;event_type:string;created_at:string}
}
export async function registerCollectionPayment(saleIds:string[],paidAt:string,paymentMethod:string,notes?:string){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('collections_register_payment',{p_sale_ids:saleIds,p_paid_at:paidAt,p_payment_method:paymentMethod,p_notes:notes||null})
  if(error){
    const message=String(error.message)
    if(message.includes('forbidden'))throw new Error('Você não tem permissão para registrar pagamentos.')
    if(message.includes('sale_cancelled'))throw new Error('Uma das vendas selecionadas está cancelada e não pode ser quitada.')
    if(message.includes('sale_already_paid'))throw new Error('Uma das vendas selecionadas já está paga com outra data/forma. Corrija-a no Davi Excel.')
    if(message.includes('sale_not_found'))throw new Error('Uma das vendas selecionadas não foi encontrada nesta organização.')
    if(message.includes('no_sales_selected'))throw new Error('Selecione ao menos uma venda para registrar o pagamento.')
    if(message.includes('payment_method_required'))throw new Error('Informe a forma de pagamento.')
    if(message.includes('paid_at_required'))throw new Error('Informe a data do pagamento.')
    if(message.includes('operator_shipping_only'))throw new Error('Seu perfil de acesso só permite alterar dados de envio nesta venda — peça a um gestor para registrar o pagamento.')
    if(message.includes('viewer_read_only'))throw new Error('Seu perfil de acesso é somente leitura.')
    if(message.includes('insufficient_available_inventory'))throw new Error('Não foi possível criar a reserva logística desta venda. Atualize a página e tente novamente.')
    if(message.includes('sale_has_active_shipment_allocation'))throw new Error('Uma das vendas selecionadas já está em separação/envio — resolva a alocação no operacional antes de registrar o pagamento aqui.')
    throw new Error(message)
  }
  return data as{changed_sale_ids:string[];skipped_sale_ids:string[];paid_at:string;payment_method:string}
}

export async function fetchSalesPage(filters:SaleFilters={},page=0,pageSize=50) {
  const { organizationId } = await authenticatedOrganization()
  const period=operationalPeriod(filters.period??{start:OPERATIONAL_START_DATE,end:'2100-12-31',label:'Operação atual'})
  let query=supabase!.from('sales')
    .select('id,client_id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,clients(name),shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))', { count:'exact' })
    .eq('organization_id', organizationId).is('deleted_at', null)
  query=query.gte('sale_date',period.start).lte('sale_date',period.end)
  if(filters.paymentStart)query=query.gte('paid_at',filters.paymentStart)
  if(filters.paymentEnd)query=query.lte('paid_at',filters.paymentEnd)
  if(filters.shippingStart)query=query.gte('shipped_at',filters.shippingStart)
  if(filters.shippingEnd)query=query.lte('shipped_at',filters.shippingEnd)
  if(filters.client)query=query.ilike('client_name_raw',`%${filters.client}%`)
  if(filters.perfume)query=query.ilike('perfume_name_raw',`%${filters.perfume}%`)
  if(filters.bottle)query=query.ilike('bottle_identifier',`%${filters.bottle}%`)
  if(filters.type)query=query.eq('sale_type',filters.type)
  if(filters.volumeMl!==undefined)query=query.eq('volume_ml',filters.volumeMl)
  if(filters.status)query=query.eq('payment_status',filters.status)
  if(filters.method)query=query.ilike('payment_method',`%${filters.method}%`)
  if(filters.origin)query=query.eq('source',filters.origin)
  if(filters.minValue!==undefined)query=query.gte('amount',filters.minValue)
  if(filters.maxValue!==undefined)query=query.lte('amount',filters.maxValue)
  if(filters.search)query=query.or(`client_name_raw.ilike.%${filters.search}%,perfume_name_raw.ilike.%${filters.search}%,bottle_identifier.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`)
  const sort=filters.sort??'perfume_name_raw_asc'
  const [column,direction]=sort.replace(/_(asc|desc)$/,'|$1').split('|')
  query=query.order(column,{ascending:direction==='asc',nullsFirst:false})
  if(column==='perfume_name_raw')query=query.order('sale_date',{ascending:false,nullsFirst:false}).order('client_name_raw',{ascending:true,nullsFirst:false})
  query=query.range(page*pageSize,page*pageSize+pageSize-1)
  const {data,error,count}=await query
  if (error) throw new Error(error.message)
  return { rows:(data ?? []) as unknown as CommercialSale[], count:count ?? 0 }
}

export async function fetchSale360(saleId:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('sales').select('id,updated_at,client_id,perfume_id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_availability_text,shipping_availability_kind,shipping_available_date,shipping_lead_business_days,shipping_availability_confirmed_at,shipping_operational_status,shipped_at,legacy_shipping_status,legacy_shipping_status_updated_at,legacy_shipping_status_updated_by,legacy_shipping_confirmation,legacy_shipping_date,legacy_shipping_confirmed_at,legacy_shipping_confirmed_by,notes,source,credit_reference_amount,inventory_allocation_eligible,clients(name,phone,whatsapp_phone,email,cpf,cnpj,postal_code,address_line,address_number,complement,district,city,state)').eq('organization_id',organizationId).eq('id',saleId).is('deleted_at',null).single()
  if(error)throw new Error(error.message)
  const [allocations,shipments]=await Promise.allSettled([
    supabase!.from('inventory_allocations').select('id,status,quantity_ml,shipment_id,allocation_source,stock_managed,verified_at,verified_by,verification_note,storage_location,inventory_items(id,physical_ml,available_ml)').eq('sale_id',saleId),
    supabase!.from('shipment_items').select('shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at)').eq('sale_id',saleId).is('removed_at',null),
  ])
  return {...data,inventory_allocations:allocations.status==='fulfilled'&&!allocations.value.error?allocations.value.data??[]:[],shipment_items:shipments.status==='fulfilled'&&!shipments.value.error?shipments.value.data??[]:[]} as unknown as CommercialSale
}
export async function confirmSaleShippingAvailability(saleId:string){const {error}=await supabase!.rpc('confirm_sale_shipping_availability',{p_sale_id:saleId});if(error)throw new Error(error.message)}

export async function confirmLegacyProductCustody(saleId:string,storageLocation:string,note:string){await currentOrganization();const {data,error}=await supabase!.rpc('confirm_legacy_product_custody',{p_sale_id:saleId,p_storage_location:storageLocation||null,p_verification_note:note||null});if(error)throw new Error(error.message);return data}
export async function releaseLegacyProductCustody(allocationId:string){await currentOrganization();const {data,error}=await supabase!.rpc('release_legacy_product_custody',{p_allocation_id:allocationId});if(error)throw new Error(error.message);return data}

export type ReservedAllocation={id:string;client_id:string;sale_id:string;quantity_ml:number;allocated_at:string;allocation_source:string;stock_managed:boolean;storage_location:string|null;clients:{name:string}|null;sales:{sale_date:string|null;amount:number;perfume_name_raw:string|null;sale_type:string|null}|null}
// Filtra no servidor (operational_sales_floor) por padrão — só baixa o
// histórico completo quando includeHistorical=true ("Mostrar histórico
// anterior" no Novo Envio), evitando trazer centenas de allocations antigas
// para escondê-las em React.
export async function fetchReservedAllocations(includeHistorical=false){
  await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('reserved_allocations_for_shipment',{p_include_historical:includeHistorical})
  if(error)throw new Error(error.message)
  return ((data??[]) as {id:string;client_id:string;client_name:string;sale_id:string;quantity_ml:number;allocated_at:string;allocation_source:string;stock_managed:boolean;storage_location:string|null;sale_date:string|null;amount:number;perfume_name_raw:string|null;sale_type:string|null}[])
    .map(row=>({id:row.id,client_id:row.client_id,sale_id:row.sale_id,quantity_ml:row.quantity_ml,allocated_at:row.allocated_at,allocation_source:row.allocation_source,stock_managed:row.stock_managed,storage_location:row.storage_location,clients:{name:row.client_name},sales:{sale_date:row.sale_date,amount:row.amount,perfume_name_raw:row.perfume_name_raw,sale_type:row.sale_type}})) as ReservedAllocation[]
}

export async function fetchDeliveryRows(period?:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const operational=operationalPeriod(period??{start:OPERATIONAL_START_DATE,end:'2100-12-31',label:'Operação atual'})
  const result:CommercialSale[]=[]
  for(let from=0;;from+=1000){
    let query=supabase!.from('sales').select('id,updated_at,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,legacy_shipping_status,legacy_shipping_status_updated_at,legacy_shipping_status_updated_by,legacy_shipping_confirmation,legacy_shipping_date,legacy_shipping_confirmed_at,legacy_shipping_confirmed_by,notes,source,clients(name),shipment_items(shipment_id,shipments(id,status,carrier,service,tracking_code,posted_at,delivered_at))')
      .eq('organization_id',organizationId).is('deleted_at',null).range(from,from+999)
    query=query.gte('sale_date',operational.start).lte('sale_date',operational.end)
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

export async function setLegacyShippingConfirmation(saleId:string,confirmation:'pending'|'sent'|'not_sent',shippingDate:string|null,expectedUpdatedAt:string,note?:string) {
  await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('set_legacy_shipping_confirmation',{p_sale_id:saleId,p_confirmation:confirmation,p_shipping_date:shippingDate,p_expected_updated_at:expectedUpdatedAt,p_note:note?.trim()||null})
  if(error){
    const message=String(error.message)
    if(message.includes('operational_shipment_confirmed'))throw new Error('Esta venda possui um envio operacional confirmado e não pode ser marcada como “Não enviado”.')
    if(message.includes('stale_sale'))throw new Error('Esta venda foi atualizada por outra pessoa. Recarregue a lista antes de confirmar.')
    if(message.includes('forbidden'))throw new Error('Você não tem permissão para alterar esta confirmação.')
    if(message.includes('sale_not_found'))throw new Error('Venda não encontrada nesta organização.')
    throw new Error(message)
  }
  return data as{sale_id:string;confirmation:'pending'|'sent'|'not_sent';shipping_date:string|null;confirmed_at:string|null;confirmed_by:string|null;updated_at:string;changed:boolean}
}

export type LegacyShippingStatusResult={sale_id:string;status:'confirmed'|'to_send'|'out_of_stock'|null;status_updated_at:string|null;status_updated_by:string|null;updated_at:string;changed:boolean}
export async function setLegacyShippingStatus(saleId:string,status:'confirmed'|'to_send'|'out_of_stock'|null,expectedUpdatedAt:string){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('set_legacy_shipping_status',{p_sale_id:saleId,p_status:status,p_expected_updated_at:expectedUpdatedAt})
  if(error){const message=String(error.message);if(message.includes('stale_sale'))throw new Error('Esta venda foi atualizada por outra pessoa. Recarregue antes de salvar.');if(message.includes('forbidden'))throw new Error('Você não tem permissão para alterar o status histórico.');if(message.includes('sale_not_found'))throw new Error('Venda não encontrada nesta organização.');throw new Error(message)}
  return data as LegacyShippingStatusResult
}

export type LogisticsSummary={identified_shipments:number;shipped_in_period:number;historical_on_time:number;historical_late:number;average_days_to_ship:number|null;operational_backlog:number;shipments_preparing:number;awaiting_approval:number;labels_released:number;posted:number;delivered:number}
export async function fetchLogisticsSummary(period:PeriodValue){const {organizationId}=await authenticatedOrganization(),operational=operationalPeriod(period);const {data,error}=await supabase!.rpc('logistics_operational_summary',{org_id:organizationId,start_date:operational.start,end_date:operational.end});if(error)throw new Error(error.message);return data as LogisticsSummary}

export type ShipmentQuote={id:string;service_id:string;service_name:string;carrier:string|null;price:number;delivery_days:number|null;delivery_min:number|null;delivery_max:number|null;available:boolean;safe_error:string|null;package:Record<string,unknown>}
export type OperationalShipment={
  id:string;organization_id:string;client_id:string;status:string;created_at:string;recipient_name:string;recipient_phone:string|null
  recipient_document:string|null;recipient_email:string|null;recipient_postal_code:string|null;recipient_address:string|null
  recipient_number:string|null;recipient_complement:string|null;recipient_district:string|null;recipient_city:string|null;recipient_state:string|null
  package_weight:number|null;package_height:number|null;package_width:number|null;package_length:number|null;package_format:string|null
  declared_value:number|null;fiscal_mode:string;selected_quote_id:string|null;carrier:string|null;service:string|null;service_id:string|null
  shipping_price:number|null;customer_approved_at?:string|null;approved_by?:string|null;superfrete_order_id:string|null;superfrete_status:string|null;checkout_status:string|null
  tracking_code:string|null;print_url:string|null;label_pdf_url:string|null;integration_error:string|null
  print_available:boolean;print_http_status:number|null;print_content_type:string|null;print_checked_at:string|null
  conference_owner_user_id:string|null;conference_owner_name_snapshot:string|null;conference_started_at:string|null;conference_completed_at:string|null
  clients:{name:string;updated_at?:string;phone?:string|null;whatsapp_phone?:string|null;cpf?:string|null;cnpj?:string|null;postal_code?:string|null;address_line?:string|null;address_number?:string|null;complement?:string|null;district?:string|null;city?:string|null;state?:string|null}|null;shipment_quotes:ShipmentQuote[];shipment_items:{allocation_id:string;quantity_ml:number;separated_at:string|null;checked_at:string|null;divergence_note:string|null;bottle_id:string|null;split_unit_id:string|null;inventory_allocations:{allocation_source:string;stock_managed:boolean;inventory_items:{bottle_tracking_status:string}|null}|null;inventory_bottles:{bottle_code:string;bottle_label:string;physical_ml:number}|null;inventory_split_units:{split_code:string;quantity_ml:number;status:string}|null;sales:{id:string;amount:number;payment_status?:string;split_completed_at?:string|null;perfume_name_raw:string|null;sale_type:string|null;shipping_deadline_date:string|null}|null}[]
  shipment_events?:{id:number;event_type:string;from_status:string|null;to_status:string|null;metadata:Record<string,unknown>;created_at:string}[]
  customer_shipment_requests?:{id:string}[]
}

const SHIPMENT_ITEMS_SELECT='shipment_items(allocation_id,quantity_ml,separated_at,checked_at,divergence_note,bottle_id,split_unit_id,inventory_allocations(allocation_source,stock_managed,inventory_items(bottle_tracking_status)),inventory_bottles(bottle_code,bottle_label,physical_ml),inventory_split_units(split_code,quantity_ml,status),sales(id,amount,payment_status,split_completed_at,perfume_name_raw,sale_type,shipping_deadline_date))'

export async function fetchOperationalShipments(){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select(`*,clients(name),customer_shipment_requests(id),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),${SHIPMENT_ITEMS_SELECT}`).eq('organization_id',organizationId).order('created_at',{ascending:false})
  if(error)throw new Error(error.message)
  return (data??[]) as unknown as OperationalShipment[]
}
export async function fetchShipment360(shipmentId:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.from('shipments').select(`*,clients(name,updated_at,phone,whatsapp_phone,cpf,cnpj,postal_code,address_line,address_number,complement,district,city,state),customer_shipment_requests(id),shipment_quotes!shipment_quotes_shipment_id_fkey(id,service_id,service_name,carrier,price,delivery_days,delivery_min,delivery_max,available,safe_error,package),${SHIPMENT_ITEMS_SELECT},shipment_events(id,event_type,from_status,to_status,metadata,created_at)`).eq('organization_id',organizationId).eq('id',shipmentId).order('created_at',{referencedTable:'shipment_events',ascending:false}).single()
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
export async function approveShipmentForLabel(shipmentId:string){await currentOrganization();const {error}=await supabase!.rpc('approve_shipment_for_label',{p_shipment_id:shipmentId});if(error){const message=String(error.message);if(message.includes('quote_changed')||message.includes('quote_not_available'))throw new Error('A cotação mudou ou não está mais disponível. Calcule novamente.');if(message.includes('forbidden'))throw new Error('Você não tem permissão para aprovar este frete.');throw new Error(message)}}
export async function cancelCustomerShipmentRequestAsStaff(shipmentId:string){await currentOrganization();const {error}=await supabase!.rpc('customer_shipment_request_cancel_staff',{p_shipment_id:shipmentId});if(error)throw new Error(error.message)}
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
  const operational=operationalPeriod(period)
  const {data,error}=await supabase!.functions.invoke('ask-intelligence',{body:{
    organization_id:organizationId,question,period_start:operational.start,period_end:operational.end,
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

export type DaviClientCandidate={id:string;name:string;reason:string;exact:boolean}
export type DaviClientCreateResult=
  |{status:'created';client:{id:string;name:string}}
  |{status:'duplicate';candidates:DaviClientCandidate[];force_allowed:boolean}

export async function createDaviExcelClient(input:{name:string;phone?:string;email?:string;cpf?:string},forceSimilar=false):Promise<DaviClientCreateResult>{
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('davi_excel_create_client',{p_organization_id:organizationId,p_payload:input,p_force_similar:forceSimilar})
  if(error){
    const code=String(error.message)
    if(code.includes('permission_denied'))throw new Error('Você não tem permissão para cadastrar clientes.')
    if(code.includes('invalid_email'))throw new Error('Informe um e-mail válido.')
    if(code.includes('invalid_cpf'))throw new Error('Informe um CPF válido.')
    if(code.includes('invalid_phone'))throw new Error('Informe um telefone válido.')
    if(code.includes('client_name_required'))throw new Error('Informe o nome da cliente.')
    throw new Error('Não foi possível cadastrar a cliente. Revise os dados e tente novamente.')
  }
  return data as DaviClientCreateResult
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
  volumeMl:number;perfumeId:string;bottleNumber?:number|null;splitCompletedAt?:string;paidAt?:string;creditReferenceAmount?:number|null
  source?:'manual'|'davi_excel';idempotencyKey?:string
}
export type SaleCreateResult={id:string;alreadyExisted:boolean}
export async function createSale(input: SaleInput):Promise<SaleCreateResult> {
  if(input.source==='davi_excel'){
    const {organizationId}=await authenticatedOrganization()
    if(!input.idempotencyKey)throw new Error('Identificador da linha ausente.')
    const {data:existing,error:existingError}=await supabase!.from('sales').select('id').eq('organization_id',organizationId).eq('source','davi_excel').eq('import_signature',input.idempotencyKey).maybeSingle()
    if(existingError)throw new Error(existingError.message)
    if(existing)return{id:String(existing.id),alreadyExisted:true}
    const {data,error}=await supabase!.rpc('davi_excel_create_sale_with_bottle',{p_payload:{client_id:input.clientId,perfume_id:input.perfumeId,sale_date:input.date,shipping_deadline_raw:input.shippingDeadlineRaw||null,shipping_deadline_date:input.shippingDeadlineDate||null,sale_type:input.saleType,volume_ml:input.volumeMl,bottle_identifier:input.bottleNumber?`FRASCO ${input.bottleNumber}`:null,split_completed_at:input.saleType==='SPLIT'?input.splitCompletedAt||null:null,amount:input.amount,payment_status:input.status,payment_method:input.method||null,paid_at:input.status==='paid'?input.paidAt||null:null,notes:input.notes||null},p_idempotency_key:input.idempotencyKey})
    if(error){if(error.message.includes('bottle_number_required')||error.message.includes('invalid_bottle_number'))throw new Error('Informe um número de frasco válido.');throw new Error(error.message)}
    return{id:String(data),alreadyExisted:false}
  }
  const { user, organizationId } = await currentOrganization()
  const {data:perfume,error:perfumeError}=await supabase!.from('perfumes').select('id,full_name_raw,base_name').eq('organization_id',organizationId).eq('id',input.perfumeId).single()
  if(perfumeError||!perfume)throw new Error('Selecione um perfume válido da organização.')
  const { data, error } = await supabase!.from('sales').insert({
    organization_id: organizationId, client_id: input.clientId,perfume_id:perfume.id,sale_date: input.date,
    amount: input.amount, payment_status: input.status, payment_method: input.method,
    notes: input.notes || null, source: 'manual', data_quality_status: 'verified', created_by: user.id,
    perfume_name_raw:perfume.full_name_raw,perfume_base_name:perfume.base_name,
    sale_type:input.saleType,volume_ml:input.volumeMl,volume_ml_raw:String(input.volumeMl),bottle_identifier:input.bottleNumber?`FRASCO ${input.bottleNumber}`:null,
    split_completed_at:input.saleType==='SPLIT'?input.splitCompletedAt||null:null,
    shipping_deadline_raw:input.shippingDeadlineRaw||null,shipping_deadline_date:input.shippingDeadlineDate||null,
    shipping_operational_status:input.shippingDeadlineDate?null:input.shippingDeadlineRaw||null,
    shipped_at:input.shippedAt||null,paid_at:input.status==='pending'?null:input.paidAt||null,
    credit_reference_amount:input.creditReferenceAmount??null,inventory_allocation_eligible:true,
    operational_created_at:new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return{id:String(data.id),alreadyExisted:false}
}
export async function parseSaleAssistant(text:string){const {data,error}=await supabase!.functions.invoke('parse-sale-assistant',{body:{text}});if(error)throw new Error('Não foi possível interpretar a anotação agora.');if(data?.error)throw new Error(data.error.message);return data.data as {fields:Record<string,unknown>;client_matches:Array<Record<string,unknown>>;perfume_matches:Array<{id:string;name:string;available_ml:number}>}}

export type AiSalesBatchSale={client_name:string;perfume_name?:string;sale_type:'APC'|'SPLIT';volume_ml:number;amount:number;client_match_status:'found'|'new'|'review';client_id:string|null;client:Record<string,unknown>|null;suggestions:{id:string;name:string;missing_shipping_fields:string[]}[];missing_shipping_fields:string[];possible_duplicate:boolean;payment_status_raw?:string|null;client_email?:string|null;client_cpf?:string|null;order_number?:string|number|null;source_order_number?:string|number|null;is_importable?:boolean}
export type AiSalesBatchGroup={perfume:string;raw_perfume_name:string;normalized_perfume_name:string;display_name:string;brand:string|null;bottle_number:number|null;inventory_item_id:string|null;perfume_id:string|null;perfume_match_status:'found'|'review'|'new';perfume_matches:{id:string;full_name_raw:string}[];inventory:Record<string,unknown>|null;sales:AiSalesBatchSale[];availability_rows:number;availability_ml?:number;availability_amount?:number;totals:{sales:number;volume_ml:number;amount:number}}
export type AiSalesBatchPreview={source_format?:'whatsapp'|'tsv';groups?:AiSalesBatchGroup[];availability_rows?:number;availability_ml?:number;availability_amount?:number;perfume:string;raw_perfume_name?:string;normalized_perfume_name?:string;display_name?:string;brand?:string|null;bottle_number:number|null;original_volume_ml:number|null;quote_per_ml:number|null;recrimping_fee:number|null;apc_volume_ml:number|null;apc_extra:number|null;pricing_consistent?:boolean;pricing_issues?:{sale_type:'APC'|'SPLIT';volume_ml:number;announced_amount:number;expected_amount:number}[];deadline_raw:string|null;deadline_day_month:string|null;shipping_deadline_date:string|null;business_days:number|null;shipping_availability_text?:string|null;shipping_availability_kind?:'available_now'|'available_from_date'|'expected_by_date'|'lead_time'|'unknown';shipping_available_date?:string|null;shipping_lead_business_days?:number|null;shipping_availability_review_required?:boolean;shipping_availability_human_confirmed?:boolean;announced_balance_ml:number|null;remaining_available_ml:number|null;sale_date:string;fingerprint:string;duplicate_batch:Record<string,unknown>|null;perfume_match_status:'found'|'review'|'new';perfume_id:string|null;inventory_item_id:string|null;perfume_matches:{id:string;full_name_raw:string}[];inventory:Record<string,unknown>|null;sales:AiSalesBatchSale[];totals:{sales:number;volume_ml:number;amount:number;calculated_balance_ml:number|null;total_operation_ml:number|null;volume_consistent:boolean};summary:{clients:number;found:number;new:number;review:number;shipping_ready:number;shipping_incomplete:number};raw_text:string}
export type AiSalesBatchMultiResult={batch_id:string;sales_created:number;clients_created:number;clients_existing:number;perfumes_processed:number;perfumes_matched:number;inventory_items_bootstrapped:number;total_ml_sold:number;total_amount_sold:number;commercial_remaining_ml:number;commercial_remaining_amount:number;inventory_remaining_ml?:number;inventory_balances?:{perfume_id:string;inventory_item_id:string;remaining_available_ml:number;available_ml:number}[];shipping_incomplete:number;paid_source_count:number;awaiting_source_count:number;unstated_payment_count:number;idempotent:boolean}
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
  inventory_resolution_required: 'Resolva o perfume de catálogo de todos os grupos antes de continuar.',
  perfume_resolution_required: 'Resolva o perfume de catálogo antes de continuar.',
  invalid_catalog_perfume: 'Confira o nome do perfume e tente cadastrá-lo novamente.',
  sale_inventory_source_reused_with_different_payload: 'Esta lista já foi usada com outro saldo. Volte, analise novamente o texto correto e confirme.',
  invalid_sale_inventory_remainder: 'Confira a sobra de ML que deve entrar no estoque.',
  perfume_not_found: 'O perfume selecionado não foi encontrado. Volte e use “Cadastrar e vincular”.',
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
// O wrapper executa internamente o write validado: supabase!.rpc('confirm_ai_sales_batch'
export async function confirmAiSalesBatch(preview:AiSalesBatchPreview){const {organizationId}=await currentOrganization();if(!preview.perfume_id)throw new Error('Resolva o perfume de catálogo.');const availability={text:preview.shipping_availability_text,kind:preview.shipping_availability_kind,date:preview.shipping_available_date,lead_business_days:preview.shipping_lead_business_days,review_required:preview.shipping_availability_review_required};const {data,error}=await supabase!.rpc('confirm_ai_sales_batch_with_availability',{p_organization_id:organizationId,p_fingerprint:preview.fingerprint,p_source_text:preview.raw_text,p_batch:preview,p_availability:availability});if(error)throw friendlyAiImportError(error.message);return data as {batch_id:string;sales_created:number;clients_created:number;shipping_incomplete:number;inventory_remaining_ml?:number;idempotent:boolean}}
export type PerfumeResolutionCandidate={perfume_id:string;name:string;brand:string|null;bottle_identifier:string|null;inventory_item_id:string|null;reconciliation_status:string|null}
export type BootstrapAiBatchInventoryResult={resolution_status:'resolved'|'ambiguous';inventory_item_id:string|null;perfume_id:string|null;resolved_name?:string;catalog_created:boolean;operational_code?:string|null;candidates?:PerfumeResolutionCandidate[]}
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
  // O wrapper executa internamente: supabase!.rpc('confirm_ai_sales_batch_multi'
  const {organizationId}=await currentOrganization()
  const groups=(preview.groups??[]).map(group=>({perfume:group.perfume,display_name:group.display_name,bottle_number:group.bottle_number,perfume_id:group.perfume_id,inventory_item_id:group.inventory_item_id,availability_ml:group.availability_ml??0,availability_amount:group.availability_amount??0,sales:group.sales}))
  const availability={text:preview.shipping_availability_text,kind:preview.shipping_availability_kind,date:preview.shipping_available_date,lead_business_days:preview.shipping_lead_business_days,review_required:preview.shipping_availability_review_required}
  const {data,error}=await supabase!.rpc('confirm_ai_sales_batch_multi_with_availability',{p_organization_id:organizationId,p_fingerprint:preview.fingerprint,p_source_text:preview.raw_text,p_sale_date:preview.sale_date,p_shipping_deadline_date:preview.shipping_deadline_date,p_deadline_raw:preview.deadline_raw,p_groups:groups,p_availability:availability})
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
  const {organizationId}=await currentOrganization(),normalized=normalizePerfumeIdentity(term)
  if(normalized.length<2)return[]
  const fields='id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code'
  const [names,brands]=await Promise.all([
    supabase!.from('perfumes').select(fields).eq('organization_id',organizationId).gte('normalized_name',normalized).lt('normalized_name',`${normalized}\uffff`).order('normalized_name').limit(12),
    supabase!.from('perfumes').select(fields).eq('organization_id',organizationId).ilike('brand_house',`%${term.trim()}%`).order('normalized_name').limit(12),
  ])
  if(names.error||brands.error)throw new Error(names.error?.message??brands.error!.message)
  return [...new Map([...(names.data??[]),...(brands.data??[])].map(row=>[row.id,row])).values()].slice(0,12)
}

export type PerfumeCandidate={id:string;full_name_raw:string;normalized_name:string;base_name:string;brand_house:string|null;bottle_identifier:string|null;operational_code:string|null}

export const normalizePerfumeIdentity=(value:unknown)=>normalizeClient(value).replace(/[‐‑‒–—―-]+/g,' ').replace(/\s+/g,' ').trim()

export async function perfumeCount(){
  const {organizationId}=await currentOrganization()
  const {count,error}=await supabase!.from('perfumes').select('id',{count:'exact',head:true}).eq('organization_id',organizationId)
  if(error)throw new Error(error.message)
  return count??0
}

export async function findEquivalentPerfumes(name:string){
  const {organizationId}=await currentOrganization(),normalizedName=normalizePerfumeIdentity(name)
  if(!normalizedName)return[]
  const {data,error}=await supabase!.from('perfumes').select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code').eq('organization_id',organizationId).limit(500)
  if(error)throw new Error(error.message)
  return ((data??[]) as PerfumeCandidate[]).filter(row=>{
    return [row.base_name,row.full_name_raw,row.normalized_name].some(value=>normalizePerfumeIdentity(value)===normalizedName)
  })
}

export async function createCanonicalPerfume(input:{name:string;brand:string}){
  const {organizationId}=await currentOrganization(),name=input.name.trim().replace(/\s+/g,' '),brand=input.brand.trim().replace(/\s+/g,' ')
  if(!name||!brand)throw new Error('Preencha nome do perfume e marca / casa.')
  const equivalent=await findEquivalentPerfumes(name)
  if(equivalent.length)return{perfume:equivalent[0],created:false}
  const normalizedName=normalizePerfumeIdentity(name)
  const {data,error}=await supabase!.from('perfumes').insert({organization_id:organizationId,full_name_raw:name,normalized_name:normalizedName,base_name:name,brand_house:brand,bottle_identifier:null}).select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code').single()
  if(error){
    if(error.code==='23505'){
      const matches=await findEquivalentPerfumes(name)
      if(matches.length)return{perfume:matches[0],created:false}
    }
    throw new Error(error.message)
  }
  return{perfume:data as PerfumeCandidate,created:true}
}

export async function fetchCanonicalPerfume(perfumeId:string){
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.from('perfumes').select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code').eq('organization_id',organizationId).eq('id',perfumeId).single()
  if(error)throw new Error(error.message)
  return data as PerfumeCandidate
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
export type InventorySaleBottleIdentity={inventory_item_id:string;bottle_identifier:string|null}
export type ExternalCustodyRow={perfume_id:string;reserved_ml:number;shipping_ml:number}
export type InventoryPreparationTotal={perfume_id:string;preparing_ml:number}

export async function fetchOperationalInventory() {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('inventory_operational_rows',{org_id:organizationId})
  if(error)throw new Error(error.message)
  return (data??[]) as OperationalInventoryRow[]
}
export async function fetchInventorySaleBottleIdentities(period:PeriodValue){const{organizationId}=await authenticatedOrganization();const{data,error}=await supabase!.from('sales').select('inventory_item_id,bottle_identifier').eq('organization_id',organizationId).is('deleted_at',null).eq('data_quality_status','verified').gte('sale_date',period.start).lte('sale_date',period.end).not('inventory_item_id','is',null);if(error)throw new Error(error.message);return(data??[])as InventorySaleBottleIdentity[]}
export async function fetchExternalCustody() {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('inventory_external_custody_rows',{org_id:organizationId})
  if(error)throw new Error(error.message)
  return (data??[]) as ExternalCustodyRow[]
}
export async function fetchInventoryPreparationTotals(){await authenticatedOrganization();const{data,error}=await supabase!.rpc('inventory_preparation_totals');if(error)throw new Error(error.message);return(data??[])as InventoryPreparationTotal[]}
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

export async function receiveInventoryPerfume(input:{perfumeId:string;receivedMl:number;minimumMl:number;referenceDate:string;notes:string;idempotencyKey:string}){
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.rpc('inventory_receive_perfume',{p_organization_id:organizationId,p_perfume_id:input.perfumeId,p_received_ml:input.receivedMl,p_minimum_ml:input.minimumMl,p_reference_date:input.referenceDate,p_notes:input.notes||null,p_idempotency_key:input.idempotencyKey})
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
export async function updateInventoryMinimum(itemId:string,minimumMl:number){
  await authenticatedOrganization()
  const{error}=await supabase!.rpc('inventory_update_minimum',{p_item_id:itemId,p_minimum_ml:minimumMl})
  if(error)throw new Error(error.message)
}

// ===== Falta Splitar =====
export type SplitStatus='not_split'|'split'
export type SplitStatusFilter='not_split'|'split'|'split_today'|'all'
export type SplitStatusFilters={search?:string;client?:string;perfume?:string;brand?:string;purchase_date?:string;bottle?:string;sale_type?:'SPLIT'|'APC'}
export type SplitStatusCards={not_split:number;split_pending:number;apc_pending:number;split_today:number;clients_pending:number;perfumes_pending:number;ml_pending:number}
export type SplitStatusPerfumeGroup={sale_type:'SPLIT'|'APC';perfume_id:string|null;perfume_name:string;brand_house:string|null;bottle_identifier:string|null;clients_count:number;items_count:number;ml_total:number}
export type SplitStatusItem={id:string;sale_type:'SPLIT'|'APC';payment_status:string;client_id:string;client_name:string;client_number:number|null;perfume_id:string|null;perfume_name:string|null;brand_house:string|null;bottle_identifier:string|null;volume_ml:number|null;sale_date:string;split_status:SplitStatus;split_completed_at:string|null;split_completed_by:string|null;updated_at:string}
const splitStatusErrorMessage=(message:string)=>{
  if(message.includes('stale_sale'))return'Este item foi atualizado por outra pessoa. Recarregue antes de tentar de novo.'
  if(message.includes('permission_denied'))return'Você não tem permissão para alterar o status de split.'
  if(message.includes('sale_not_found'))return'Venda não encontrada.'
  if(message.includes('sale_not_eligible_for_separation'))return'Esta venda não é SPLIT nem APC.'
  if(message.includes('bulk_separation_selection_not_eligible'))return'Um ou mais itens não são SPLIT/APC ou você não tem permissão para alterá-los.'
  return message
}
export async function fetchSplitStatusCards(){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('sale_split_status_cards')
  if(error)throw new Error(error.message)
  return data as SplitStatusCards
}
export async function fetchSplitStatusPerfumeSummary(status:SplitStatusFilter,filters:SplitStatusFilters={}){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('sale_split_status_perfume_summary',{p_status:status,p_filters:filters})
  if(error)throw new Error(error.message)
  return(data??[])as SplitStatusPerfumeGroup[]
}
export async function fetchSplitStatusItems(options:{perfumeId?:string|null;status?:SplitStatusFilter;filters?:SplitStatusFilters;saleIds?:string[];page?:number;pageSize?:number}={}){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('sale_split_status_list',{
    p_perfume_id:options.perfumeId??null,p_status:options.status??'not_split',p_filters:options.filters??{},
    p_sale_ids:options.saleIds??null,p_page:options.page??0,p_page_size:options.pageSize??200,
  })
  if(error)throw new Error(error.message)
  const result=data as{rows:SplitStatusItem[];total:number}|null
  return result??{rows:[],total:0}
}
export async function fetchAllSplitStatusItems(status:SplitStatusFilter,filters:SplitStatusFilters={}){
  const rows:SplitStatusItem[]=[]
  for(let page=0;;page++){
    const result=await fetchSplitStatusItems({status,filters,page,pageSize:500})
    rows.push(...result.rows)
    if(rows.length>=result.total||result.rows.length===0)break
  }
  return rows
}
export async function setSplitStatus(saleId:string,status:SplitStatus,expectedUpdatedAt:string){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('set_sale_split_status',{p_sale_id:saleId,p_status:status,p_expected_updated_at:expectedUpdatedAt})
  if(error)throw new Error(splitStatusErrorMessage(error.message))
  return data as{id:string;split_status:SplitStatus;split_completed_at:string|null;updated_at:string;unchanged:boolean}
}
export type SplitStatusBulkResult={updated:string[];updated_count:number;completed_at:string}
export async function setSplitStatusBulk(saleIds:string[]){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('set_sale_split_status_bulk',{p_sale_ids:saleIds,p_status:'split'})
  if(error)throw new Error(splitStatusErrorMessage(error.message))
  return data as SplitStatusBulkResult
}
export async function completeSplitStatusForFilter(filters:SplitStatusFilters={}){
  await authenticatedOrganization()
  const{data,error}=await supabase!.rpc('complete_sale_splits_for_filter',{p_filters:filters})
  if(error)throw new Error(splitStatusErrorMessage(error.message))
  return data as SplitStatusBulkResult
}
