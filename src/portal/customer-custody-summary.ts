import type { CustodyItem, ShipmentRequest } from '../lib/customer-portal'

const requestMl = (request: ShipmentRequest) => request.items?.reduce((sum, item) => sum + Number(item.quantity_ml), 0) ?? 0

export function summarizeCustomerCustody(custody: CustodyItem[], requests: ShipmentRequest[]) {
  const physicalMl = custody.reduce((sum, item) => sum + Number(item.quantity_ml), 0)
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
  return requests.find(request => request.status !== 'cancelled' && request.items?.some(item => item.allocation_id === allocationId))
}

export type CustomerPerfumeGroup = {
  perfume_id: string
  perfume_name: string
  total_ml: number
  available_ml: number
  open_requested_ml: number
  allocations: CustodyItem[]
  available_allocations: CustodyItem[]
  active_request?: ShipmentRequest
}

export function groupCustomerCustody(items: CustodyItem[], requests: ShipmentRequest[]): CustomerPerfumeGroup[] {
  const groups = new Map<string, CustomerPerfumeGroup>()
  for (const item of items) {
    const activeRequest = requestForAllocation(requests, item.allocation_id)
    const committed = item.requested || Boolean(activeRequest)
    const available = item.allocation_status === 'reserved' && !committed
    const group = groups.get(item.perfume_id) ?? { perfume_id:item.perfume_id, perfume_name:item.perfume_name, total_ml:0, available_ml:0, open_requested_ml:0, allocations:[], available_allocations:[], active_request:undefined }
    group.total_ml += Number(item.quantity_ml)
    group.allocations.push(item)
    if (available) { group.available_ml += Number(item.quantity_ml); group.available_allocations.push(item) }
    if (committed) group.open_requested_ml += Number(item.quantity_ml)
    if (!group.active_request && activeRequest) group.active_request = activeRequest
    groups.set(item.perfume_id, group)
  }
  return [...groups.values()].sort((a,b)=>a.perfume_name.localeCompare(b.perfume_name))
}
