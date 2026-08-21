import type { CustodyItem, ShipmentRequest } from '../lib/customer-portal'

const requestMl = (request: ShipmentRequest) => request.items?.reduce((sum, item) => sum + Number(item.quantity_ml), 0) ?? 0

export function summarizeCustomerCustody(custody: CustodyItem[], requests: ShipmentRequest[]) {
  const physicalMl = custody.reduce((sum, item) => sum + Number(item.quantity_ml), 0)
  const availableMl = custody
    .filter(item => item.allocation_status === 'reserved' && !item.requested)
    .reduce((sum, item) => sum + Number(item.quantity_ml), 0)
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
