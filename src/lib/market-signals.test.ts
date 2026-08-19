import { describe, expect, it } from 'vitest'
import { ReplenishmentSignal } from './replenishment'
import { WaitlistEntry } from './waitlist'
import { computeMarketSignals } from './market-signals'

function signal(overrides: Partial<ReplenishmentSignal> & { perfume_id: string }): ReplenishmentSignal {
  return {
    item_id: `item-${overrides.perfume_id}`, perfume: 'Naxos', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: '50ml',
    available_ml: 10, minimum_ml: 20, physical_ml: 10, reconciliation_status: 'reconciled',
    ml_7d: 0, ml_30d: 0, ml_60d: 0, ml_90d: 0, sales_count_7d: 0, sales_count_30d: 0, sales_count_90d: 0,
    last_sale_at: null, velocity_ml_per_day: null, coverage_days: null, status: 'saudavel', priority_score: 0,
    ...overrides,
  }
}

function entry(overrides: Partial<WaitlistEntry> & { perfume_id: string }): WaitlistEntry {
  return {
    entry_id: `w-${overrides.perfume_id}`, client_id: 'c1', client_name: 'Duda', perfume_name: 'Naxos',
    brand_house: 'Xerjoff', requested_ml: 10, status: 'waiting', created_at: '2026-08-01T00:00:00Z', notes: null,
    available_ml: 0, ready: false,
    ...overrides,
  }
}

describe('computeMarketSignals — demanda não atendida', () => {
  it('sinaliza quando um cliente espera um perfume crítico', () => {
    const signals = computeMarketSignals(
      [entry({ perfume_id: 'p1', client_name: 'Duda' })],
      [signal({ perfume_id: 'p1', status: 'critico' })],
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ type: 'demanda_nao_atendida', perfumeId: 'p1', severity: 'alta' })
    expect(signals[0].message).toContain('Duda')
  })
  it('não sinaliza quando o perfume está saudável — só espera não é sinal, estoque travando é', () => {
    const signals = computeMarketSignals(
      [entry({ perfume_id: 'p1' })],
      [signal({ perfume_id: 'p1', status: 'saudavel' })],
    )
    expect(signals).toHaveLength(0)
  })
  it('não sinaliza um item de waitlist já atendido/cancelado', () => {
    const signals = computeMarketSignals(
      [entry({ perfume_id: 'p1', status: 'fulfilled' })],
      [signal({ perfume_id: 'p1', status: 'critico' })],
    )
    expect(signals).toHaveLength(0)
  })
  it('não sinaliza quando não existe sinal de reposição para o perfume esperado (sem_dados/perfume desconhecido)', () => {
    const signals = computeMarketSignals([entry({ perfume_id: 'p1' })], [])
    expect(signals).toHaveLength(0)
  })
})

describe('computeMarketSignals — aceleração de venda', () => {
  it('sinaliza quando o ritmo de 7 dias é claramente maior que a média de 30 dias', () => {
    // 7d: 70ml em 7 dias = 10ml/dia. 30d: 90ml em 30 dias = 3ml/dia. razão ~3.3x.
    const signals = computeMarketSignals([], [signal({ perfume_id: 'p1', ml_7d: 70, ml_30d: 90 })])
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ type: 'aceleracao_venda', perfumeId: 'p1' })
  })
  it('não sinaliza um ritmo estável (7d e 30d proporcionais)', () => {
    // 7d: 21ml em 7 dias = 3ml/dia. 30d: 90ml em 30 dias = 3ml/dia. razão 1x.
    const signals = computeMarketSignals([], [signal({ perfume_id: 'p1', ml_7d: 21, ml_30d: 90 })])
    expect(signals).toHaveLength(0)
  })
  it('não sinaliza quando não há venda recente (zero é zero, nunca vira divisão fantasma)', () => {
    const signals = computeMarketSignals([], [signal({ perfume_id: 'p1', ml_7d: 0, ml_30d: 90 })])
    expect(signals).toHaveLength(0)
  })
  it('não sinaliza quando não há baseline de 30 dias (perfume novo, sem histórico suficiente)', () => {
    const signals = computeMarketSignals([], [signal({ perfume_id: 'p1', ml_7d: 10, ml_30d: 0 })])
    expect(signals).toHaveLength(0)
  })
})

describe('computeMarketSignals — ordenação', () => {
  it('sinais de severidade alta vêm antes dos de severidade média', () => {
    // 'moderado': 35ml/7d = 5ml/dia vs 90ml/30d = 3ml/dia -> razão ~1.67x (media, abaixo do dobro do limiar).
    const moderado = signal({ perfume_id: 'moderado', ml_7d: 35, ml_30d: 90 })
    // 'urgente': demanda não atendida é sempre severidade alta.
    const urgente = entry({ perfume_id: 'urgente' })
    const signals = computeMarketSignals([urgente], [signal({ perfume_id: 'urgente', status: 'critico' }), moderado])
    expect(signals[0].severity).toBe('alta')
    expect(signals[1].severity).toBe('media')
  })
})
