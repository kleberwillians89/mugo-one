import type { CustodyItem, ShipmentRequest } from '../lib/customer-portal'

const requestMl = (request: ShipmentRequest) => request.items?.reduce((sum, item) => sum + Number(item.quantity_ml), 0) ?? 0

const activePhysicalStatuses = new Set(['awaiting_customer_approval','customer_approved','draft','requested','label_pending','label_released'])

function custodyWithCanonicalShipments(custody: CustodyItem[], requests: ShipmentRequest[]) {
  const merged=[...custody]
  const allocationIds=new Set(custody.map(item=>item.allocation_id))
  for(const request of requests){
    if(request.source!=='shipment'||!activePhysicalStatuses.has(request.shipment_status??''))continue
    for(const item of request.items??[]){
      if(!item.allocation_id||!item.perfume_id||allocationIds.has(item.allocation_id))continue
      merged.push({allocation_id:item.allocation_id,perfume_id:item.perfume_id,perfume_name:item.perfume,quantity_ml:Number(item.quantity_ml),sale_date:null,allocation_status:'shipping',requested:true,request_id:request.customer_request_id??null,shipping_requestable:false,requestable_quantity_ml:0})
      allocationIds.add(item.allocation_id)
    }
  }
  return merged
}

export function summarizeCustomerCustody(custody: CustodyItem[], requests: ShipmentRequest[]) {
  const physicalMl = custodyWithCanonicalShipments(custody,requests).reduce((sum, item) => sum + Number(item.quantity_ml), 0)
  const availableMl = groupCustomerCustody(custody,requests).reduce((sum,group)=>sum+group.available_ml,0)
  const awaitingApprovalMl = requests
    .filter(request => request.shipment_status === 'awaiting_customer_approval')
    .reduce((sum, request) => sum + requestMl(request), 0)
  const preparingMl = requests
    .filter(request => ['draft', 'requested', 'customer_approved', 'label_pending', 'label_released'].includes(request.shipment_status ?? ''))
    .reduce((sum, request) => sum + requestMl(request), 0)
  const inTransitMl = requests
    .filter(request => request.shipment_status === 'posted')
    .reduce((sum, request) => sum + requestMl(request), 0)

  return { physicalMl, availableMl, awaitingApprovalMl, preparingMl, inTransitMl }
}

export function requestForAllocation(requests: ShipmentRequest[], allocationId: string) {
  return requests.find(request => request.status !== 'cancelled' && !['cancelled','posted','delivered'].includes(request.shipment_status??'') && request.items?.some(item => item.allocation_id === allocationId))
}

export type CustomerPerfumeGroup = {
  perfume_id: string
  perfume_name: string
  total_ml: number
  available_ml: number
  open_requested_ml: number
  pending_availability_ml: number
  allocations: CustodyItem[]
  available_allocations: CustodyItem[]
  active_request?: ShipmentRequest
}

export function groupCustomerCustody(items: CustodyItem[], requests: ShipmentRequest[]): CustomerPerfumeGroup[] {
  const groups = new Map<string, CustomerPerfumeGroup>()
  for (const item of custodyWithCanonicalShipments(items,requests)) {
    const activeRequest = requestForAllocation(requests, item.allocation_id)
    const committed = item.allocation_status === 'shipping' || item.requested || Boolean(activeRequest)
    const requestableMl=Number(item.requestable_quantity_ml??item.quantity_ml)
    const available = item.allocation_status === 'reserved' && !committed && item.shipping_requestable !== false && requestableMl>0
    const group = groups.get(item.perfume_id) ?? { perfume_id:item.perfume_id, perfume_name:item.perfume_name, total_ml:0, available_ml:0, open_requested_ml:0, pending_availability_ml:0, allocations:[], available_allocations:[], active_request:undefined }
    group.total_ml += Number(item.quantity_ml)
    group.allocations.push(item)
    if (available) { group.available_ml += requestableMl; group.available_allocations.push({...item,quantity_ml:requestableMl}) }
    if (!committed && item.shipping_requestable === false) group.pending_availability_ml += Number(item.quantity_ml)
    if (committed) group.open_requested_ml += Number(item.quantity_ml)
    if (!group.active_request && activeRequest) group.active_request = activeRequest
    groups.set(item.perfume_id, group)
  }
  return [...groups.values()].sort((a,b)=>a.perfume_name.localeCompare(b.perfume_name))
}
