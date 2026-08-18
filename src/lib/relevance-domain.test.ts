import { describe, expect, it } from 'vitest'
import {
  classifyRelevance, classifySizeMatch, classifySourceType, extractSizeMentionsMl, flagPriceOutliers, matchesExclusionPhrase,
} from '../../supabase/functions/_shared/relevance-domain'

const CANONICAL = { brand: 'Amouage', perfumeName: 'Guidance 46', sizeMl: 100 }

describe('classifyRelevance: casos reais do primeiro smoke (item 15)', () => {
  it('"Amouage Guidance 46 Extrait De Parfum" sem tamanho no título → likely (nome cheio, tamanho ausente)', () => {
    expect(classifyRelevance('Amouage Guidance 46 Extrait De Parfum', CANONICAL)).toBe('likely')
  })

  it('"Amouage Guidance 46 Eau de Parfum 100ml" → exact (marca + nome + tamanho batem)', () => {
    expect(classifyRelevance('Amouage Guidance 46 Eau de Parfum 100ml', CANONICAL)).toBe('exact')
  })

  it('"Amouage Guidance Body Lotion" → excluded', () => {
    expect(classifyRelevance('Amouage Guidance Body Lotion', CANONICAL)).toBe('excluded')
  })

  it('"AMOUAGE Guidance Shower Gel" → excluded (case-insensitive)', () => {
    expect(classifyRelevance('AMOUAGE Guidance Shower Gel', CANONICAL)).toBe('excluded')
  })

  it('"Amouage Guidance Hair Perfume" → excluded', () => {
    expect(classifyRelevance('Amouage Guidance Hair Perfume', CANONICAL)).toBe('excluded')
  })

  it('"Amouage Guidance 46 Sample & Decants Travel Set" → excluded', () => {
    expect(classifyRelevance('Amouage Guidance 46 Sample & Decants Travel Set', CANONICAL)).toBe('excluded')
  })

  it('"Amouage Guidance Exceptional Gift Set" → excluded', () => {
    expect(classifyRelevance('Amouage Guidance Exceptional Gift Set', CANONICAL)).toBe('excluded')
  })

  it('"Amouage Guidance Eau de Parfum" (sem "46") quando a query é "Guidance 46" → weak, nunca exact', () => {
    expect(classifyRelevance('Amouage Guidance Eau de Parfum', CANONICAL)).toBe('weak')
  })

  it('"Amouage Guidance 46 Eau de Parfum 2ml" quando a query pede 100ml → excluded', () => {
    expect(classifyRelevance('Amouage Guidance 46 Eau de Parfum 2ml', CANONICAL)).toBe('excluded')
  })
})

describe('classifyRelevance: regras adicionais (itens 6-9)', () => {
  it('não exige ordem exata das palavras para o nome', () => {
    expect(classifyRelevance('46 Guidance Amouage 100ml', CANONICAL)).toBe('exact')
  })

  it('aceita equivalência em oz claramente explícita (3.4oz ~= 100ml)', () => {
    expect(classifyRelevance('Amouage Guidance 46 Eau de Parfum 3.4oz', CANONICAL)).toBe('exact')
    expect(classifyRelevance('Amouage Guidance 46 Eau de Parfum 3.4 fl oz', CANONICAL)).toBe('exact')
  })

  it('título ambíguo com dois tamanhos ("100ml / 2ml") nunca vira exact automaticamente', () => {
    expect(classifyRelevance('Amouage Guidance 46 100ml / 2ml', CANONICAL)).toBe('weak')
  })

  it('sem marca no título e sem nome batendo → weak, nunca exact', () => {
    expect(classifyRelevance('Random Perfume 100ml', CANONICAL)).toBe('weak')
  })

  it('sem tamanho pedido, nome completo já é suficiente para exact', () => {
    expect(classifyRelevance('Amouage Guidance 46 Eau de Parfum', { brand: 'Amouage', perfumeName: 'Guidance 46', sizeMl: null })).toBe('exact')
  })

  it('inspired/dupe/impression/similar to são sempre excluded mesmo com marca e nome batendo', () => {
    expect(classifyRelevance('Amouage Guidance 46 Inspired Perfume Oil 100ml', CANONICAL)).toBe('excluded')
    expect(classifyRelevance('Dupe of Amouage Guidance 46 100ml', CANONICAL)).toBe('excluded')
    expect(classifyRelevance('Amouage Guidance 46 Impression 100ml', CANONICAL)).toBe('excluded')
    expect(classifyRelevance('Similar to Amouage Guidance 46 100ml', CANONICAL)).toBe('excluded')
  })
})

describe('matchesExclusionPhrase', () => {
  it.each(['sample', 'samples', 'decant', 'decants', 'tester', 'body lotion', 'lotion', 'shower gel', 'hair perfume', 'gift set', 'inspired', 'dupe', 'impression', 'similar to'])(
    'reconhece "%s" independente de posição/maiúsculas', (phrase) => {
      expect(matchesExclusionPhrase(`Amouage Guidance 46 ${phrase.toUpperCase()} Edition`)).toBe(true)
    },
  )
  it('título sem nenhuma dessas palavras não é excluído por isso', () => {
    expect(matchesExclusionPhrase('Amouage Guidance 46 Eau de Parfum 100ml')).toBe(false)
  })
})

describe('extractSizeMentionsMl / classifySizeMatch', () => {
  it('extrai "100ml" e "100 ml" igualmente', () => {
    expect(extractSizeMentionsMl('Guidance 46 100ml')).toEqual([100])
    expect(extractSizeMentionsMl('Guidance 46 100 ml')).toEqual([100])
  })

  it('sem tamanho pedido, retorna not_requested mesmo se o título tiver tamanho', () => {
    expect(classifySizeMatch('Guidance 46 2ml', null)).toBe('not_requested')
  })

  it('tamanho pedido ausente no título → absent', () => {
    expect(classifySizeMatch('Amouage Guidance 46 Eau de Parfum', 100)).toBe('absent')
  })

  it('tamanho pedido presente e único → match', () => {
    expect(classifySizeMatch('Amouage Guidance 46 100ml', 100)).toBe('match')
  })

  it('tamanho pedido ausente, só um tamanho diferente presente → mismatch', () => {
    expect(classifySizeMatch('Amouage Guidance 46 2ml', 100)).toBe('mismatch')
  })

  it('tamanho pedido presente junto de outro tamanho diferente → ambiguous', () => {
    expect(classifySizeMatch('Amouage Guidance 46 100ml / 2ml', 100)).toBe('ambiguous')
  })
})

describe('classifySourceType: marketplace nunca é removido, mas nunca herda confiança', () => {
  it('reconhece eBay pelo nome do vendedor', () => {
    expect(classifySourceType('eBay', null)).toBe('marketplace')
  })
  it('reconhece Amazon/Etsy pelo nome', () => {
    expect(classifySourceType('Amazon.co.uk', null)).toBe('marketplace')
    expect(classifySourceType('Etsy', null)).toBe('marketplace')
  })
  it('reconhece marketplace pelo domínio quando o nome não ajuda', () => {
    expect(classifySourceType(null, 'https://www.ebay.co.uk/itm/123')).toBe('marketplace')
  })
  it('revendedor reconhecido (Harrods) nunca é classificado como marketplace', () => {
    expect(classifySourceType('Harrods', 'https://www.harrods.com/product/x')).toBeNull()
  })
  it('sem seller nem url reconhecíveis, retorna null (não inventa classificação)', () => {
    expect(classifySourceType(null, null)).toBeNull()
  })
})

describe('flagPriceOutliers: sinaliza sem excluir, nunca acusa fraude', () => {
  it('preço muito distante da mediana (mesma moeda, exact/likely) é sinalizado', () => {
    const offers = [
      { price_native: 500, currency: 'GBP', relevance: 'exact' as const },
      { price_native: 510, currency: 'GBP', relevance: 'exact' as const },
      { price_native: 520, currency: 'GBP', relevance: 'likely' as const },
      { price_native: 5000, currency: 'GBP', relevance: 'exact' as const },
    ]
    expect(flagPriceOutliers(offers)).toEqual([false, false, false, true])
  })

  it('itens weak/excluded nunca entram na mediana nem são sinalizados', () => {
    const offers = [
      { price_native: 500, currency: 'GBP', relevance: 'exact' as const },
      { price_native: 510, currency: 'GBP', relevance: 'exact' as const },
      { price_native: 1, currency: 'GBP', relevance: 'weak' as const },
      { price_native: 99999, currency: 'GBP', relevance: 'excluded' as const },
    ]
    expect(flagPriceOutliers(offers)).toEqual([false, false, false, false])
  })

  it('sem moeda confirmada, nunca compara nem sinaliza', () => {
    const offers = [
      { price_native: 500, currency: null, relevance: 'exact' as const },
      { price_native: 50000, currency: null, relevance: 'exact' as const },
    ]
    expect(flagPriceOutliers(offers)).toEqual([false, false])
  })

  it('moedas diferentes nunca são comparadas entre si', () => {
    const offers = [
      { price_native: 500, currency: 'GBP', relevance: 'exact' as const },
      { price_native: 500, currency: 'EUR', relevance: 'exact' as const },
    ]
    expect(flagPriceOutliers(offers)).toEqual([false, false])
  })
})
