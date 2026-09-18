export const shipmentStatusLabels:Record<string,string>={
  draft:'Rascunho',requested:'Preparando envio',awaiting_customer_approval:'Aguardando aprovação do time',
  customer_approved:'Aprovado pelo time',label_pending:'Emitindo etiqueta',label_released:'Pronto para postar',
  posted:'Postado',delivered:'Entregue',cancelled:'Cancelado',
}

export type ShipmentNextAction='approve_team'|'create_label'|'checkout'|'sync'|'print'|'track'|'none'
export type ShipmentActionState={status:string;superfrete_order_id:string|null;superfrete_status:string|null;checkout_status:string|null;print_available:boolean;print_url:string|null;label_pdf_url:string|null;tracking_code:string|null;integration_error?:string|null}
const cancelledStatuses=new Set(['canceled','cancelled','cancelado','cancelada'])
const isCancelled=(status:string|null)=>cancelledStatuses.has(String(status||'').trim().toLowerCase())

export function getShipmentNextAction(shipment:ShipmentActionState):ShipmentNextAction{
  const external=String(shipment.superfrete_status||'').toLowerCase()
  if(isCancelled(shipment.superfrete_status))return 'none'
  if(shipment.status==='delivered')return 'none'
  if(shipment.status==='posted'||external==='posted'||external==='delivered')return shipment.tracking_code?'track':'sync'
  if(shipment.status==='awaiting_customer_approval')return 'approve_team'
  if(shipment.checkout_status==='cart_created')return 'checkout'
  if(!shipment.superfrete_order_id)return 'create_label'
  if(['released','posted','delivered'].includes(external)&&shipment.print_available&&Boolean(shipment.print_url||shipment.label_pdf_url))return 'print'
  return 'sync'
}

export function shipmentHumanState(shipment:ShipmentActionState){
  const action=getShipmentNextAction(shipment),external=String(shipment.superfrete_status||'').toLowerCase()
  if(isCancelled(shipment.superfrete_status))return 'Etiqueta cancelada'
  if(shipment.status==='delivered'||external==='delivered')return 'Entregue'
  if(shipment.status==='posted'||external==='posted')return 'Objeto postado'
  if(action==='checkout')return 'Etiqueta aguardando pagamento'
  if(action==='print')return 'Etiqueta pronta para imprimir'
  if(action==='sync')return external==='pending'?'Etiqueta aguardando liberação':'Etiqueta sendo preparada'
  return shipment.status==='customer_approved'?'Frete aprovado pelo time':shipment.status==='awaiting_customer_approval'?'Aguardando aprovação do time':'Preparando produtos'
}

export type LabelUiState={title:string;description:string;canSync:boolean;canPrint:boolean;canCopyTracking:boolean;primaryAction:ShipmentNextAction;printUnavailableReason:string|null;isCancelled:boolean}
export function getLabelUiState(shipment:ShipmentActionState):LabelUiState{
  const primaryAction=getShipmentNextAction(shipment),hasOrder=Boolean(shipment.superfrete_order_id),hasTracking=Boolean(shipment.tracking_code)
  const printableStatus=['released','posted','delivered'].includes(String(shipment.superfrete_status||'').toLowerCase())
  const canPrint=printableStatus&&shipment.print_available&&Boolean(shipment.print_url||shipment.label_pdf_url)
  if(isCancelled(shipment.superfrete_status))return {title:'ETIQUETA CANCELADA',description:'Esta etiqueta foi cancelada na SuperFrete. Nenhum arquivo de impressão está disponível.',canSync:false,canPrint:false,canCopyTracking:hasTracking,primaryAction:'none',printUnavailableReason:'Esta etiqueta foi cancelada na SuperFrete.',isCancelled:true}
  if(primaryAction==='approve_team')return {title:'AGUARDANDO APROVAÇÃO DO TIME',description:'O frete selecionado precisa ser aprovado pela equipe antes da etiqueta.',canSync:false,canPrint:false,canCopyTracking:false,primaryAction,printUnavailableReason:'Aguarde a aprovação interna antes de criar a etiqueta.',isCancelled:false}
  if(primaryAction==='checkout')return {title:'ETIQUETA AGUARDANDO PAGAMENTO',description:'O pedido foi criado na SuperFrete, mas a compra ainda não foi concluída.',canSync:true,canPrint:false,canCopyTracking:hasTracking,primaryAction,printUnavailableReason:'A compra precisa ser confirmada antes da impressão.',isCancelled:false}
  if(canPrint)return {title:'ETIQUETA PRONTA',description:'A compra foi concluída e o arquivo oficial está disponível.',canSync:true,canPrint:true,canCopyTracking:hasTracking,primaryAction:'print',printUnavailableReason:null,isCancelled:false}
  if(hasOrder&&printableStatus){
    // released/posted/delivered já dispara uma sondagem real do arquivo a
    // cada sincronização (ver superfrete-sync-shipment) — então, se já foi
    // sincronizado ao menos uma vez, integration_error SEMPRE reflete o
    // resultado real dessa sondagem (nulo quando disponível, um dos
    // SUPERFRETE_FILE_* quando não). "Ainda sendo preparado" só é verdade
    // antes da primeira sincronização; depois disso, dizer isso quando na
    // verdade JÁ tentamos e falhamos estaria mentindo sobre o estado real
    // (bug relatado: painel oficial já libera impressão, o sistema insiste
    // que "está sendo preparado" mesmo depois de sincronizar).
    const probedAndUnavailable=Boolean(shipment.integration_error)&&shipment.integration_error!=='SUPERFRETE_PROVIDER_PROCESSING'
    if(probedAndUnavailable)return {title:'ETIQUETA LIBERADA — ARQUIVO PENDENTE',description:'A etiqueta foi emitida na SuperFrete, mas o sistema ainda não conseguiu obter o arquivo oficial para impressão.',canSync:true,canPrint:false,canCopyTracking:hasTracking,primaryAction:'sync',printUnavailableReason:'O sistema ainda não conseguiu obter o arquivo oficial da SuperFrete. Tente sincronizar novamente.',isCancelled:false}
    return {title:'ETIQUETA CRIADA',description:'A compra foi concluída e o rastreio já foi gerado. O arquivo ainda está sendo preparado pela SuperFrete.',canSync:true,canPrint:false,canCopyTracking:hasTracking,primaryAction:'sync',printUnavailableReason:'A SuperFrete ainda não liberou o arquivo para impressão.',isCancelled:false}
  }
  if(hasOrder)return {title:'ETIQUETA SENDO PREPARADA',description:'A SuperFrete ainda está processando o arquivo. Você não precisa criar outra etiqueta.',canSync:true,canPrint:false,canCopyTracking:hasTracking,primaryAction:'sync',printUnavailableReason:'A SuperFrete ainda não liberou o arquivo para impressão.',isCancelled:false}
  return {title:'CRIAR ETIQUETA',description:'Prepare o pedido da etiqueta depois da conferência e aprovação.',canSync:false,canPrint:false,canCopyTracking:false,primaryAction:'create_label',printUnavailableReason:'Crie o pedido antes de imprimir.',isCancelled:false}
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

// Movido de components/ShipmentOperations.tsx (Fase 4 do roadmap operacional
// — Smart Shipping Queue) para poder ser reutilizado por lib/shipment-queue.ts
// sem criar um import circular entre um componente e a lib que ele usa.
export type Stage='preparing'|'conference'|'freight'|'label'|'posted'|'delivered'
export const stageLabels:Record<Stage,string>={preparing:'Em preparação',conference:'Conferência',freight:'Frete',label:'Etiqueta',posted:'Postado',delivered:'Entregue'}
type StageShipment=ShipmentActionState&{selected_quote_id:string|null;shipment_items:{checked_at:string|null;divergence_note:string|null}[]}
export function shipmentStage(row:StageShipment):Stage{
  if(row.status==='delivered')return 'delivered'
  if(row.status==='posted')return 'posted'
  if(row.status==='label_pending'||row.status==='label_released'||row.superfrete_order_id)return 'label'
  if(row.status==='awaiting_customer_approval'||row.status==='customer_approved'||row.selected_quote_id)return 'freight'
  const conferred=row.shipment_items.length>0&&row.shipment_items.every(item=>item.checked_at&&!item.divergence_note)
  return conferred?'conference':'preparing'
}
