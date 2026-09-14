import type {OperationalShipment,ReservedAllocation} from './records'

export type ShippingTaskFilter='quote'|'approval'|'conference'|'label'|'post'|'data'

export const isShipmentConferenceComplete=(shipment:OperationalShipment)=>shipment.shipment_items.length>0&&shipment.shipment_items.every(item=>Boolean(item.checked_at)&&!item.divergence_note)

export const isShipmentCommerciallyReady=(shipment:OperationalShipment)=>shipment.shipment_items.length>0&&shipment.shipment_items.every(item=>{
  const sale=item.sales
  if(!sale)return false
  return sale.payment_status==='paid'&&(!['SPLIT','APC'].includes(String(sale.sale_type||'').toUpperCase())||Boolean(sale.split_completed_at))
})

export const isShipmentRecipientIncomplete=(shipment:OperationalShipment)=>[
  shipment.recipient_name,shipment.recipient_document,shipment.recipient_email,shipment.recipient_phone,
  shipment.recipient_postal_code,shipment.recipient_address,shipment.recipient_number,shipment.recipient_district,
  shipment.recipient_city,shipment.recipient_state,
].some(value=>!String(value??'').trim())

export function matchesShippingTask(row:OperationalShipment,task:ShippingTaskFilter){
  if(['posted','delivered','cancelled'].includes(row.status))return false
  if(task==='data')return isShipmentRecipientIncomplete(row)
  if(task==='quote')return ['draft','requested'].includes(row.status)&&!row.selected_quote_id
  if(task==='approval')return row.status==='awaiting_customer_approval'
  if(task==='conference')return row.status==='customer_approved'&&(!isShipmentConferenceComplete(row)||!isShipmentCommerciallyReady(row))
  if(task==='label')return ['customer_approved','label_pending'].includes(row.status)&&isShipmentConferenceComplete(row)&&isShipmentCommerciallyReady(row)&&!row.print_available
  return row.status==='label_released'||row.print_available
}

export function summarizeShippingTasks(shipments:OperationalShipment[],allocations:ReservedAllocation[]){
  const waitingClients=new Set(allocations.map(row=>row.client_id))
  return{
    paidWaitingClients:waitingClients.size,
    nextWaitingSaleId:allocations[0]?.sale_id??null,
    awaitingQuote:shipments.filter(row=>matchesShippingTask(row,'quote')).length,
    awaitingApproval:shipments.filter(row=>matchesShippingTask(row,'approval')).length,
    awaitingConference:shipments.filter(row=>matchesShippingTask(row,'conference')).length,
    labelsToIssue:shipments.filter(row=>matchesShippingTask(row,'label')).length,
    readyToPost:shipments.filter(row=>matchesShippingTask(row,'post')).length,
  }
}

export function countClientsMissingShippingData(shipments:OperationalShipment[]){
  return new Set(shipments.filter(row=>!['posted','delivered','cancelled'].includes(row.status)&&isShipmentRecipientIncomplete(row)).map(row=>row.client_id)).size
}
