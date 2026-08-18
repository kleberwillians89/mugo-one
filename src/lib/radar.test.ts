import { describe, expect, it } from 'vitest'
import { normalizeSearchQuery, parsePerfumeQuery, validateManualOffer } from './radar'

describe('parsePerfumeQuery', () => {
  it('reconhece a marca no início do texto ("marca nome tamanho") sem reordenar palavras', () => {
    const result = parsePerfumeQuery('Amouage Guidance 46 100ml')
    expect(result.brand).toBe('Amouage')
    expect(result.perfumeName).toBe('Guidance 46')
    expect(result.sizeMl).toBe(100)
  })

  it('reconhece a marca no fim do texto ("nome marca tamanho")', () => {
    const result = parsePerfumeQuery('Guidance 46 Amouage 100ml')
    expect(result.sizeMl).toBe(100)
    expect(result.brand).toBe('Amouage')
    expect(result.perfumeName).toBe('Guidance 46')
  })

  it('não confunde tamanho com identidade principal', () => {
    const result = parsePerfumeQuery('Naxos Xerjoff 50ml')
    expect(result.sizeMl).toBe(50)
    expect(result.brand).toBe('Xerjoff')
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

  it('separador "nome — marca" também funciona quando a marca não é reconhecida', () => {
    const result = parsePerfumeQuery('Produto Desconhecido — Marca Nova')
    expect(result.brand).toBe('Marca Nova')
    expect(result.perfumeName).toBe('Produto Desconhecido')
  })
})

describe('normalizeSearchQuery', () => {
  it('só colapsa espaços redundantes, nunca reordena palavras', () => {
    expect(normalizeSearchQuery('Amouage   Guidance 46   100ml')).toBe('Amouage Guidance 46 100ml')
  })

  it('preserva a ordem original mesmo com marca no início', () => {
    const input = 'Amouage Guidance 46 100ml'
    expect(normalizeSearchQuery(input)).toBe(input)
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
