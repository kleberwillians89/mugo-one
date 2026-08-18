import { describe, expect, it } from 'vitest'
import { parsePerfumeQuery, validateManualOffer } from './radar'

describe('parsePerfumeQuery', () => {
  it('separa marca, nome e tamanho quando "nome marca" é informado', () => {
    const result = parsePerfumeQuery('Guidance 46 Amouage 100ml')
    expect(result.sizeMl).toBe(100)
    expect(result.brand).toBe('Amouage')
    expect(result.perfumeName).toBe('Guidance 46')
  })

  it('não confunde tamanho com identidade principal', () => {
    const result = parsePerfumeQuery('Naxos Xerjoff 50ml')
    expect(result.sizeMl).toBe(50)
    expect(result.perfumeName).not.toMatch(/ml/i)
  })

  it('aceita vírgula decimal no tamanho', () => {
    const result = parsePerfumeQuery('Naxos Xerjoff 12,5ml')
    expect(result.sizeMl).toBe(12.5)
  })

  it('sem tamanho retorna sizeMl nulo', () => {
    const result = parsePerfumeQuery('Naxos Xerjoff')
    expect(result.sizeMl).toBeNull()
  })
})

describe('validateManualOffer', () => {
  const base = { url: 'https://loja.example/produto', price_native: 100, currency: 'EUR' }

  it('rejeita oferta sem URL', () => {
    expect(() => validateManualOffer({ ...base, url: '' })).toThrow('Informe a URL da fonte.')
  })

  it('rejeita URL que não é http(s)', () => {
    expect(() => validateManualOffer({ ...base, url: 'ftp://loja.example' })).toThrow('Informe a URL da fonte.')
  })

  it('rejeita preço negativo', () => {
    expect(() => validateManualOffer({ ...base, price_native: -1 })).toThrow('Informe um preço válido.')
  })

  it('rejeita moeda que não tem 3 letras', () => {
    expect(() => validateManualOffer({ ...base, currency: 'euro' })).toThrow('Informe a moeda em 3 letras')
  })

  it('aceita payload válido sem lançar', () => {
    expect(() => validateManualOffer(base)).not.toThrow()
  })
})
