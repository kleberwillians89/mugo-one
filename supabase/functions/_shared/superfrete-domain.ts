export type EmissionAction='create_cart'|'checkout_existing'|'sync_existing'|'blocked_uncertain'
export function emissionAction(orderId:string|null|undefined,checkoutStatus:string|null|undefined):EmissionAction{
  if(checkoutStatus==='cart_uncertain'||checkoutStatus==='checkout_uncertain'||checkoutStatus==='checkout_started')return 'blocked_uncertain'
  if(orderId&&checkoutStatus==='cart_created')return 'checkout_existing'
  if(orderId)return 'sync_existing'
  return 'create_cart'
}

export type InternalShipmentState='unchanged'|'label_released'|'posted'|'delivered'|'cancelled'
export function mapSuperFreteStatus(status:unknown):InternalShipmentState{
  switch(String(status??'').toLowerCase()){
    case'released':return'label_released'
    case'posted':return'posted'
    case'delivered':return'delivered'
    case'cancelled':case'canceled':return'cancelled'
    default:return'unchanged'
  }
}

export function checkoutPayload(orderId:string){if(!orderId.trim())throw new Error('order_id_required');return {orders:[orderId]}}

export const numberValue=(value:unknown)=>{const parsed=Number(String(value??0).replace(',','.'));return Number.isFinite(parsed)?parsed:0}
export function normalizeQuote(item:Record<string,unknown>){
  const packages=Array.isArray(item.packages)?item.packages:[],first=(packages[0]||{}) as Record<string,unknown>
  const hasError=Boolean(item.error||item.has_error),price=numberValue(item.price??first.price)
  return {service_id:String(item.id??''),service_name:String(item.name??'Serviço'),
    carrier:String((item.company as Record<string,unknown>|undefined)?.name??item.name??''),price,currency:'BRL',
    delivery_days:Number(item.delivery_time||0)||null,
    delivery_min:Number((item.delivery_range as Record<string,unknown>|undefined)?.min||0)||null,
    delivery_max:Number((item.delivery_range as Record<string,unknown>|undefined)?.max||0)||null,
    package:first,available:!hasError&&price>0,safe_error:hasError?'Serviço indisponível para este pacote.':null}
}

export type SafeProviderError={code:string;message:string;httpStatus:number;uncertain:boolean}
export const isTimeout=(error:unknown)=>error instanceof DOMException&&error.name==='AbortError'
export function safeProviderError(error:unknown):SafeProviderError{
  if(isTimeout(error))return {code:'SUPERFRETE_TIMEOUT',message:'A SuperFrete não confirmou a operação dentro do tempo limite.',httpStatus:504,uncertain:true}
  if(error instanceof Error&&error.message==='superfrete_not_configured')return {code:'SUPERFRETE_NOT_CONFIGURED',message:'A integração SuperFrete ainda não está configurada.',httpStatus:500,uncertain:false}
  const status=Number((error as {status?:number})?.status||0)
  if(status===401||status===403)return {code:'SUPERFRETE_AUTH',message:'A autenticação da SuperFrete precisa ser revisada.',httpStatus:502,uncertain:false}
  if(status===429)return {code:'SUPERFRETE_RATE_LIMIT',message:'A SuperFrete limitou temporariamente as solicitações.',httpStatus:503,uncertain:false}
  if(status>=400&&status<500)return {code:`SUPERFRETE_HTTP_${status}`,message:'A SuperFrete recusou os dados da operação.',httpStatus:502,uncertain:false}
  return {code:status?`SUPERFRETE_HTTP_${status}`:'SUPERFRETE_NETWORK_ERROR',message:'A SuperFrete não confirmou a operação.',httpStatus:502,uncertain:true}
}
