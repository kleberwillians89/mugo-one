import { describe, expect, it } from 'vitest'
import { isUrgentShipment, sortShipmentQueue } from './shipment-queue'
import { OperationalShipment } from './records'

function makeShipment(overrides: Partial<OperationalShipment> & { id: string }): OperationalShipment {
  return {
    organization_id: 'org1', client_id: 'c1', status: 'draft', created_at: '2026-08-10T10:00:00Z',
    recipient_name: 'Cliente', recipient_phone: null, recipient_document: null, recipient_email: null,
    recipient_postal_code: null, recipient_address: null, recipient_number: null, recipient_complement: null,
    recipient_district: null, recipient_city: null, recipient_state: null,
    package_weight: null, package_height: null, package_width: null, package_length: null, package_format: null,
    declared_value: null, fiscal_mode: 'nfe', selected_quote_id: null, carrier: null, service: null, service_id: null,
    shipping_price: null, superfrete_order_id: null, superfrete_status: null, checkout_status: null,
    tracking_code: null, print_url: null, label_pdf_url: null, integration_error: null,
    print_available: false, print_http_status: null, print_content_type: null, print_checked_at: null,
    conference_owner_user_id: null, conference_owner_name_snapshot: null, conference_started_at: null, conference_completed_at: null,
    clients: null, shipment_quotes: [], shipment_items: [],
    ...overrides,
  }
}

const itemWithDeadline = (deadline: string | null) => ({
  allocation_id: 'a1', quantity_ml: 10, separated_at: null, checked_at: null, divergence_note: null, bottle_id: null,
  inventory_allocations: null, inventory_bottles: null,
  sales: { id: 's1', amount: 100, perfume_name_raw: 'Naxos', sale_type: 'SPLIT', shipping_deadline_date: deadline },
})

describe('isUrgentShipment', () => {
  it('vencido: urgente', () => {
    const shipment = makeShipment({ id: '1', shipment_items: [itemWithDeadline('2020-01-01')] })
    expect(isUrgentShipment(shipment)).toBe(true)
  })
  it('vence em 2 dias: urgente', () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 1)
    const shipment = makeShipment({ id: '1', shipment_items: [itemWithDeadline(soon.toISOString().slice(0, 10))] })
    expect(isUrgentShipment(shipment)).toBe(true)
  })
  it('vence em 30 dias: não urgente', () => {
    const far = new Date(); far.setDate(far.getDate() + 30)
    const shipment = makeShipment({ id: '1', shipment_items: [itemWithDeadline(far.toISOString().slice(0, 10))] })
    expect(isUrgentShipment(shipment)).toBe(false)
  })
  it('sem prazo informado: não urgente', () => {
    const shipment = makeShipment({ id: '1', shipment_items: [itemWithDeadline(null)] })
    expect(isUrgentShipment(shipment)).toBe(false)
  })
  it('já postado: nunca urgente, mesmo com prazo vencido (não é mais fila de trabalho)', () => {
    const shipment = makeShipment({ id: '1', status: 'posted', shipment_items: [itemWithDeadline('2020-01-01')] })
    expect(isUrgentShipment(shipment)).toBe(false)
  })
})

describe('sortShipmentQueue', () => {
  it('urgente vem antes de não-urgente, independente da etapa', () => {
    const normal = makeShipment({ id: 'normal', status: 'draft', created_at: '2026-08-01T00:00:00Z' })
    const urgent = makeShipment({ id: 'urgent', status: 'customer_approved', selected_quote_id: 'q1', created_at: '2026-08-15T00:00:00Z', shipment_items: [itemWithDeadline('2020-01-01')] })
    expect(sortShipmentQueue([normal, urgent]).map((s) => s.id)).toEqual(['urgent', 'normal'])
  })
  it('sem urgência, etapa que precisa de mais trabalho vem primeiro', () => {
    const label = makeShipment({ id: 'label', status: 'label_released', superfrete_order_id: 'x' })
    const preparing = makeShipment({ id: 'preparing', status: 'draft' })
    expect(sortShipmentQueue([label, preparing]).map((s) => s.id)).toEqual(['preparing', 'label'])
  })
  it('mesma etapa: o mais antigo vem primeiro (nada fica esquecido)', () => {
    const newer = makeShipment({ id: 'newer', created_at: '2026-08-15T00:00:00Z' })
    const older = makeShipment({ id: 'older', created_at: '2026-08-01T00:00:00Z' })
    expect(sortShipmentQueue([newer, older]).map((s) => s.id)).toEqual(['older', 'newer'])
  })
  it('postado/entregue ficam no fim da fila', () => {
    const delivered = makeShipment({ id: 'delivered', status: 'delivered', created_at: '2026-01-01T00:00:00Z' })
    const preparing = makeShipment({ id: 'preparing', status: 'draft', created_at: '2026-08-15T00:00:00Z' })
    expect(sortShipmentQueue([delivered, preparing]).map((s) => s.id)).toEqual(['preparing', 'delivered'])
  })
  it('não muta o array original', () => {
    const rows = [makeShipment({ id: 'a' }), makeShipment({ id: 'b' })]
    const sorted = sortShipmentQueue(rows)
    expect(sorted).not.toBe(rows)
  })
})
