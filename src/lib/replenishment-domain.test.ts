import { describe, expect, it } from 'vitest'
import { buildDeterministicSummary, ReplenishmentSignalRow } from '../../supabase/functions/_shared/replenishment-domain'

const base:ReplenishmentSignalRow = {
  item_id: 'i1', perfume_id: 'p1', perfume: 'Naxos', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: '100ml',
  available_ml: 4, minimum_ml: 10, physical_ml: 4, reconciliation_status: 'reconciled',
  ml_7d: 10, ml_30d: 31, ml_60d: 40, ml_90d: 50,
  sales_count_7d: 3, sales_count_30d: 6, sales_count_90d: 9,
  last_sale_at: '2026-08-15',
  velocity_ml_per_day: 1.033, coverage_days: 3.9,
  status: 'repor', priority_score: 68,
}

describe('buildDeterministicSummary: fallback sem IA — nunca recalcula, só narra', () => {
  it('reproduz o exemplo do spec (Naxos: 4ml, 31ml/30d, cobertura ~4 dias)', () => {
    const text = buildDeterministicSummary(base)
    expect(text).toBe('Naxos merece reposição. Restam 4 ml disponíveis e foram vendidos 31 ml nos últimos 30 dias. No ritmo recente, o estoque atual tem cobertura estimada de 4 dias.')
  })

  it('nunca junta frases sem espaço (ex.: "reposição.Restam")', () => {
    const text = buildDeterministicSummary(base)
    expect(text).not.toMatch(/[a-zà-ú]\.[A-ZÀ-Ú]/)
  })

  it('crítico usa a frase de status correta', () => {
    const text = buildDeterministicSummary({ ...base, status: 'critico', available_ml: 0 })
    expect(text).toContain('está crítico')
  })

  it('sem_dados nunca menciona cobertura/velocidade inventada', () => {
    const text = buildDeterministicSummary({ ...base, status: 'sem_dados', last_sale_at: null, velocity_ml_per_day: null, coverage_days: null, ml_30d: 0 })
    expect(text).toContain('ainda não tem histórico de vendas suficiente')
    expect(text).not.toMatch(/cobertura|velocidade/i)
  })

  it('saudável sem venda no período omite a frase de vendas, nunca diz "0 ml"', () => {
    const text = buildDeterministicSummary({ ...base, status: 'saudavel', ml_30d: 0, coverage_days: null })
    expect(text).not.toContain('0 ml nos últimos 30 dias')
  })
})
