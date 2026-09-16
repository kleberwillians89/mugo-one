import { describe, expect, it } from 'vitest'
import { toCustomer, type ClientRow } from './customer.types'

function baseRow(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: 'customer-1',
    organization_id: 'org-1',
    name: 'Maria Silva',
    cpf: null,
    cnpj: null,
    email: null,
    phone: null,
    whatsapp_phone: null,
    address_line: null,
    address_number: null,
    complement: null,
    district: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    owner_user_id: null,
    status: 'active',
    source: 'manual',
    source_channel: null,
    source_campaign: null,
    source_medium: null,
    source_external_id: null,
    attribution_metadata: null,
    metadata: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('toCustomer', () => {
  it('deriva document/documentType de cpf quando só cpf está preenchido', () => {
    const customer = toCustomer(baseRow({ cpf: '12345678900' }))
    expect(customer.documentType).toBe('cpf')
    expect(customer.document).toBe('12345678900')
  })

  it('deriva document/documentType de cnpj quando só cnpj está preenchido', () => {
    const customer = toCustomer(baseRow({ cnpj: '12345678000199' }))
    expect(customer.documentType).toBe('cnpj')
    expect(customer.document).toBe('12345678000199')
  })

  it('prioriza cnpj sobre cpf quando ambos estão preenchidos (nunca deveria acontecer na prática, mas não deve quebrar)', () => {
    const customer = toCustomer(baseRow({ cpf: '12345678900', cnpj: '12345678000199' }))
    expect(customer.documentType).toBe('cnpj')
    expect(customer.document).toBe('12345678000199')
  })

  it('document/documentType ficam null quando não há nem cpf nem cnpj', () => {
    const customer = toCustomer(baseRow())
    expect(customer.documentType).toBeNull()
    expect(customer.document).toBeNull()
  })

  it('nunca perde cpf/cnpj como campos legados — document é derivado, não substitui', () => {
    const row = baseRow({ cpf: '12345678900' })
    const customer = toCustomer(row)
    expect(row.cpf).toBe('12345678900')
    expect(customer.document).toBe(row.cpf)
  })

  it('country e metadata/attributionMetadata caem em defaults seguros quando vêm null do banco', () => {
    const customer = toCustomer(baseRow({ country: null, metadata: null, attribution_metadata: null }))
    expect(customer.country).toBe('BR')
    expect(customer.metadata).toEqual({})
    expect(customer.attributionMetadata).toEqual({})
  })

  it('mapeia whatsapp a partir de whatsapp_phone', () => {
    const customer = toCustomer(baseRow({ whatsapp_phone: '+5511999999999' }))
    expect(customer.whatsapp).toBe('+5511999999999')
  })
})
