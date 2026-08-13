export const shipmentStatusLabels:Record<string,string>={
  draft:'Rascunho',requested:'Preparando envio',awaiting_customer_approval:'Aguardando aprovação do cliente',
  customer_approved:'Aprovado pelo cliente',label_pending:'Emitindo etiqueta',label_released:'Pronto para postar',
  posted:'Postado',delivered:'Entregue',cancelled:'Cancelado',
}

export type ShippingFields={recipient_name?:unknown;recipient_document?:unknown;recipient_email?:unknown;recipient_phone?:unknown;recipient_postal_code?:unknown;recipient_address?:unknown;recipient_number?:unknown;recipient_district?:unknown;recipient_city?:unknown;recipient_state?:unknown;package_weight?:unknown;package_height?:unknown;package_width?:unknown;package_length?:unknown;service_id?:unknown}
const text=(value:unknown)=>String(value??'').trim()
export function missingQuoteFields(value:ShippingFields){
  const missing:string[]=[]
  if(text(value.recipient_postal_code).replace(/\D/g,'').length!==8)missing.push('CEP do destinatário')
  for(const [key,label] of [['package_weight','peso'],['package_height','altura'],['package_width','largura'],['package_length','comprimento']] as const)
    if(!(Number(value[key])>0))missing.push(label)
  return missing
}
export function missingLabelFields(value:ShippingFields){
  const missing=missingQuoteFields(value)
  for(const [key,label] of [['recipient_name','nome'],['recipient_document','CPF/CNPJ'],['recipient_email','e-mail'],['recipient_phone','telefone'],['recipient_address','endereço'],['recipient_number','número'],['recipient_district','bairro'],['recipient_city','cidade']] as const)
    if(!text(value[key]))missing.push(label)
  if(text(value.recipient_state).length!==2)missing.push('UF')
  if(!text(value.service_id))missing.push('serviço de frete')
  return [...new Set(missing)]
}
export const canQuoteShipment=(status:string)=>['draft','requested'].includes(status)
export const canBuyLabel=(status:string,missing:string[])=>status==='customer_approved'&&missing.length===0
