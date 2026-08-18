import { describe, expect, it } from 'vitest'
import { NEEDS_ATTENTION, STATUS_LABEL, buildRadarQuery, formatReplenishmentSummary } from './replenishment'

describe('buildRadarQuery: identidade canônica, nunca inventa tamanho', () => {
  it('usa base_name + brand_house quando disponíveis', () => {
    expect(buildRadarQuery({ perfume: 'Xerjoff Naxos', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: null })).toBe('Naxos Xerjoff')
  })

  it('acrescenta o tamanho só quando bottle_identifier traz uma referência segura', () => {
    expect(buildRadarQuery({ perfume: 'x', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: '100ML' })).toBe('Naxos Xerjoff 100ml')
  })

  it('sem bottle_identifier, não inventa tamanho nenhum', () => {
    const query = buildRadarQuery({ perfume: 'x', brand_house: 'Xerjoff', base_name: 'Naxos', bottle_identifier: null })
    expect(query).not.toMatch(/\d+\s*ml/i)
  })

  it('sem brand_house, usa só o nome — nunca quebra', () => {
    expect(buildRadarQuery({ perfume: 'Naxos', brand_house: null, base_name: 'Naxos', bottle_identifier: null })).toBe('Naxos')
  })

  it('cai para "perfume" quando base_name está vazio', () => {
    expect(buildRadarQuery({ perfume: 'Naxos Xerjoff', brand_house: null, base_name: '', bottle_identifier: null })).toBe('Naxos Xerjoff')
  })
})

describe('formatReplenishmentSummary: frase determinística (espelha o backend)', () => {
  it('reproduz o exemplo do spec (Naxos: 4ml restantes, 31ml em 30 dias, cobertura ~4 dias)', () => {
    const text = formatReplenishmentSummary({ perfume: 'Naxos', status: 'repor', available_ml: 4, ml_30d: 31, coverage_days: 3.9 })
    expect(text).toContain('Naxos')
    expect(text).toContain('merece reposição')
    expect(text).toContain('4 ml disponíveis')
    expect(text).toContain('31 ml nos últimos 30 dias')
    expect(text).toContain('4 dias')
  })

  it('sem histórico suficiente, nunca inventa velocidade/cobertura', () => {
    const text = formatReplenishmentSummary({ perfume: 'Guidance 46', status: 'sem_dados', available_ml: 2, ml_30d: 0, coverage_days: null })
    expect(text).toContain('ainda não tem histórico de vendas suficiente')
    expect(text).not.toMatch(/cobertura/i)
  })

  it('sem vendas no período, omite a frase de vendas em vez de dizer "0 ml vendidos"', () => {
    const text = formatReplenishmentSummary({ perfume: 'X', status: 'atencao', available_ml: 10, ml_30d: 0, coverage_days: null })
    expect(text).not.toContain('0 ml nos últimos 30 dias')
  })
})

describe('STATUS_LABEL / NEEDS_ATTENTION: vocabulário e agrupamento consistentes', () => {
  it('cobre os 5 estados do spec', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(['atencao', 'critico', 'repor', 'saudavel', 'sem_dados'].sort())
  })
  it('"precisa repor" agrupa crítico e repor, nunca atenção/saudável/sem dados', () => {
    expect(NEEDS_ATTENTION).toEqual(['critico', 'repor'])
  })
})
