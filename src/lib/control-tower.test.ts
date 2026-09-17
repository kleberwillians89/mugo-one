import { describe, expect, it } from 'vitest'
import { PerfumeMarginRow } from './cost-margin'
import { RadarOffer } from './radar'
import { ReplenishmentSignal } from './replenishment'
import { countStrongOpportunities } from '../legacy/control-tower/control-tower'

function signal(overrides: Partial<ReplenishmentSignal> & { perfume_id: string }): ReplenishmentSignal {
  return {
    item_id: `item-${overrides.perfume_id}`, perfume: 'Naxos', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: '50ml',
    available_ml: 10, minimum_ml: 20, physical_ml: 10, reconciliation_status: 'reconciled',
    ml_7d: 0, ml_30d: 0, ml_60d: 0, ml_90d: 0, sales_count_7d: 0, sales_count_30d: 0, sales_count_90d: 0,
    last_sale_at: null, velocity_ml_per_day: null, coverage_days: null, status: 'critico', priority_score: 0,
    ...overrides,
  }
}

function marginRow(overrides: Partial<PerfumeMarginRow> & { perfume_id: string }): PerfumeMarginRow {
  return {
    perfume_name: 'Naxos', units_sold: 1, total_ml: 10, revenue: 100,
    average_cost_per_ml: 5, known_cost: 50, margin: 50, margin_pct: 50, has_cost: true,
    ...overrides,
  }
}

function offer(overrides: Partial<RadarOffer> & { perfume_id: string }): RadarOffer {
  return {
    id: `o-${overrides.perfume_id}`, organization_id: 'org1', watch_item_id: null, source_id: null,
    seller_name: 'Harrods', domain: 'harrods.com', url: 'https://harrods.com/x', country_code: 'GB', country_name: 'Reino Unido',
    raw_title: 'Naxos 50ml', price_native: 165, currency: 'BRL', price_brl: null, size_ml: 50,
    concentration: null, availability_status: 'in_stock', shipping_to_brazil: 'yes', shipping_notes: null,
    source_type: 'authorized_retailer', confidence_score: 90,
    first_seen_at: '2026-08-01', last_seen_at: '2026-08-18', last_checked_at: '2026-08-18', active: true, metadata: {},
    entry_method: 'provider', source_name: 'Harrods', source_trusted: true, score: 80,
    ...overrides,
  }
}

describe('countStrongOpportunities', () => {
  it('counts a perfume that needs restock, has a healthy known margin, and a trusted comparable offer', () => {
    const count = countStrongOpportunities(
      [signal({ perfume_id: 'p1', status: 'critico' })],
      [marginRow({ perfume_id: 'p1', margin_pct: 40, has_cost: true })],
      [offer({ perfume_id: 'p1' })],
    )
    expect(count).toBe(1)
  })
  it('does not count a perfume with unknown margin, even with a great offer', () => {
    const count = countStrongOpportunities(
      [signal({ perfume_id: 'p1', status: 'critico' })],
      [], // no margin row at all -> has_cost defaults to false
      [offer({ perfume_id: 'p1' })],
    )
    expect(count).toBe(0)
  })
  it('does not count a perfume that is not in need of restock, regardless of margin/offers', () => {
    const count = countStrongOpportunities(
      [signal({ perfume_id: 'p1', status: 'saudavel' })],
      [marginRow({ perfume_id: 'p1', margin_pct: 90 })],
      [offer({ perfume_id: 'p1' })],
    )
    expect(count).toBe(0)
  })
  it('sums across multiple qualifying perfumes', () => {
    const count = countStrongOpportunities(
      [signal({ perfume_id: 'p1' }), signal({ perfume_id: 'p2' }), signal({ perfume_id: 'p3', status: 'saudavel' })],
      [marginRow({ perfume_id: 'p1' }), marginRow({ perfume_id: 'p2' })],
      [offer({ perfume_id: 'p1' }), offer({ perfume_id: 'p2' })],
    )
    expect(count).toBe(2)
  })
  it('ignores offers for a different perfume than the one being evaluated', () => {
    const count = countStrongOpportunities(
      [signal({ perfume_id: 'p1' })],
      [marginRow({ perfume_id: 'p1' })],
      [offer({ perfume_id: 'p2' })], // offer belongs to a different perfume
    )
    expect(count).toBe(0)
  })
})
