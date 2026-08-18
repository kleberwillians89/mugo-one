import { describe, expect, it } from 'vitest'
import { PerfumeMarginRow, marginTone, summarizeMargin } from './cost-margin'

function row(overrides: Partial<PerfumeMarginRow> = {}): PerfumeMarginRow {
  return {
    perfume_id: '1', perfume_name: 'Naxos', units_sold: 1, total_ml: 10, revenue: 100,
    average_cost_per_ml: 5, known_cost: 50, margin: 50, margin_pct: 50, has_cost: true,
    ...overrides,
  }
}

describe('marginTone', () => {
  it('is neutral when the perfume has no known cost', () => {
    expect(marginTone(null)).toBe('neutral')
  })
  it('is danger for a negative margin (selling below cost)', () => {
    expect(marginTone(-5)).toBe('danger')
  })
  it('is warning for a thin margin under 20%', () => {
    expect(marginTone(19.9)).toBe('warning')
  })
  it('is success for a healthy margin at or above 20%', () => {
    expect(marginTone(20)).toBe('success')
    expect(marginTone(60)).toBe('success')
  })
})

describe('summarizeMargin', () => {
  it('sums revenue, known cost and margin across priced rows', () => {
    const totals = summarizeMargin([row({ revenue: 100, known_cost: 50, margin: 50 }), row({ revenue: 200, known_cost: 120, margin: 80 })])
    expect(totals).toEqual({ revenue: 300, knownCost: 170, margin: 130, unpriced: 0 })
  })
  it('still counts revenue for unpriced perfumes but excludes them from known cost and margin', () => {
    const totals = summarizeMargin([
      row({ revenue: 100, known_cost: 50, margin: 50, has_cost: true }),
      row({ revenue: 40, known_cost: null, margin: null, has_cost: false }),
    ])
    expect(totals).toEqual({ revenue: 140, knownCost: 50, margin: 50, unpriced: 1 })
  })
  it('returns all zeros for an empty period', () => {
    expect(summarizeMargin([])).toEqual({ revenue: 0, knownCost: 0, margin: 0, unpriced: 0 })
  })
})
