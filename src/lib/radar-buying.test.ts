import { describe, expect, it } from 'vitest'
import { RadarOffer } from './radar'
import { classifyBuyingSignal, isComparableOffer, pickBestOffer } from './radar-buying'

function offer(overrides: Partial<RadarOffer> = {}): RadarOffer {
  return {
    id: 'o1', organization_id: 'org1', perfume_id: 'p1', watch_item_id: null, source_id: null,
    seller_name: 'Harrods', domain: 'harrods.com', url: 'https://harrods.com/x', country_code: 'GB', country_name: 'Reino Unido',
    raw_title: 'Naxos 50ml', price_native: 165, currency: 'GBP', price_brl: 1150, size_ml: 50,
    concentration: null, availability_status: 'in_stock', shipping_to_brazil: 'yes', shipping_notes: null,
    source_type: 'authorized_retailer', confidence_score: 90,
    first_seen_at: '2026-08-01', last_seen_at: '2026-08-18', last_checked_at: '2026-08-18', active: true, metadata: {},
    entry_method: 'provider', source_name: 'Harrods', source_trusted: true, score: 80,
    ...overrides,
  }
}

describe('isComparableOffer', () => {
  it('BRL currency is always comparable', () => {
    expect(isComparableOffer(offer({ currency: 'BRL', price_brl: null }))).toBe(true)
  })
  it('a foreign currency with a persisted price_brl is comparable', () => {
    expect(isComparableOffer(offer({ currency: 'GBP', price_brl: 1150 }))).toBe(true)
  })
  it('a foreign currency with no price_brl is NOT comparable — never fabricate FX here', () => {
    expect(isComparableOffer(offer({ currency: 'GBP', price_brl: null }))).toBe(false)
  })
})

describe('pickBestOffer', () => {
  it('returns null when there are no offers', () => {
    expect(pickBestOffer([])).toBeNull()
  })
  it('ignores inactive offers', () => {
    expect(pickBestOffer([offer({ id: 'inactive', active: false })])).toBeNull()
  })
  it('prefers a comparable offer over a higher-score but incomparable one', () => {
    const incomparableHighScore = offer({ id: 'a', currency: 'GBP', price_brl: null, score: 99 })
    const comparableLowScore = offer({ id: 'b', currency: 'BRL', price_brl: null, score: 10 })
    expect(pickBestOffer([incomparableHighScore, comparableLowScore])?.id).toBe('b')
  })
  it('among comparable offers, prefers a trusted source over a higher score', () => {
    const untrustedHighScore = offer({ id: 'a', source_trusted: false, score: 99 })
    const trustedLowScore = offer({ id: 'b', source_trusted: true, score: 10 })
    expect(pickBestOffer([untrustedHighScore, trustedLowScore])?.id).toBe('b')
  })
  it('among equally comparable+trusted offers, prefers the higher score', () => {
    const lower = offer({ id: 'a', score: 50 })
    const higher = offer({ id: 'b', score: 90 })
    expect(pickBestOffer([lower, higher])?.id).toBe('b')
  })
})

describe('classifyBuyingSignal', () => {
  it('dados_insuficientes when there is no replenishment signal at all', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: null, hasCost: false, marginPct: null, bestOffer: null })).toBe('dados_insuficientes')
  })
  it('dados_insuficientes when status is sem_dados', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'sem_dados', hasCost: false, marginPct: null, bestOffer: null })).toBe('dados_insuficientes')
  })
  it('baixa_prioridade when the perfume is not in need of restock (saudavel)', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'saudavel', hasCost: true, marginPct: 50, bestOffer: offer() })).toBe('baixa_prioridade')
  })
  it('baixa_prioridade for atencao too, regardless of how good the offer looks', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'atencao', hasCost: true, marginPct: 50, bestOffer: offer() })).toBe('baixa_prioridade')
  })
  it('forte_oportunidade requires needing restock + healthy known margin + a trusted comparable offer', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: true, marginPct: 42, bestOffer: offer() })).toBe('forte_oportunidade')
    expect(classifyBuyingSignal({ replenishmentStatus: 'repor', hasCost: true, marginPct: 20, bestOffer: offer() })).toBe('forte_oportunidade')
  })
  it('investigar when it needs restock but margin is unknown — unknown margin is never treated as zero or as healthy', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: false, marginPct: null, bestOffer: offer() })).toBe('investigar')
  })
  it('investigar when it needs restock but the margin is thin (<20%)', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: true, marginPct: 5, bestOffer: offer() })).toBe('investigar')
  })
  it('investigar when it needs restock but there is no offer at all — unknown price is never treated as zero', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: true, marginPct: 50, bestOffer: null })).toBe('investigar')
  })
  it('investigar when the only offer is untrusted', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: true, marginPct: 50, bestOffer: offer({ source_trusted: false }) })).toBe('investigar')
  })
  it('investigar when the only offer is in a foreign currency with no persisted BRL price — never compares incompatible currencies', () => {
    expect(classifyBuyingSignal({ replenishmentStatus: 'critico', hasCost: true, marginPct: 50, bestOffer: offer({ currency: 'USD', price_brl: null }) })).toBe('investigar')
  })
})
