import { describe, expect, it } from 'vitest'
import {
  buildSerperRequestBody, extractCurrency, extractShoppingResults, normalizeShoppingResult,
  providerMarketFor, safeSerperError, serperResponseError,
} from '../../supabase/functions/_shared/serper-domain'

describe('providerMarketFor: UK precisa de mapeamento explícito para o Serper', () => {
  it('mercado interno "uk" mapeia para "gb" — confirmado empiricamente (gl=uk devolvia resultados dos EUA)', () => {
    expect(providerMarketFor('uk')).toBe('gb')
  })

  it('nunca envia o código interno "uk" direto ao provider', () => {
    expect(providerMarketFor('uk')).not.toBe('uk')
  })

  it('mercados sem mapeamento explícito passam adiante sem alteração', () => {
    expect(providerMarketFor('fr')).toBe('fr')
    expect(providerMarketFor('de')).toBe('de')
  })
})

describe('extractCurrency: nunca inventa moeda ambígua', () => {
  it('reconhece GBP pelo símbolo £', () => expect(extractCurrency('£510.00')).toBe('GBP'))
  it('reconhece GBP pelo código explícito', () => expect(extractCurrency('510.00 GBP')).toBe('GBP'))
  it('não confirma moeda para $ sozinho (ambíguo entre USD/CAD/AUD/etc.)', () => expect(extractCurrency('$104.97')).toBeNull())
  it('não confirma moeda quando o preço é ausente', () => expect(extractCurrency(undefined)).toBeNull())
  it('não confirma moeda quando o preço é uma string vazia', () => expect(extractCurrency('')).toBeNull())
})

describe('extractShoppingResults: lê raw.shopping (contrato real do Serper, não shopping_results)', () => {
  it('lê o array "shopping" quando presente', () => {
    expect(extractShoppingResults({ shopping: [{ title: 'a' }] })).toEqual([{ title: 'a' }])
  })
  it('nunca lê "shopping_results" (contrato do provider anterior, não é o do Serper)', () => {
    expect(extractShoppingResults({ shopping_results: [{ title: 'a' }] })).toEqual([])
  })
  it('retorna lista vazia quando "shopping" está ausente — zero resultados não é erro', () => {
    expect(extractShoppingResults({})).toEqual([])
  })
  it('retorna lista vazia para payload nulo/indefinido', () => {
    expect(extractShoppingResults(null)).toEqual([])
    expect(extractShoppingResults(undefined)).toEqual([])
  })
})

describe('serperResponseError: erro explícito do Serper dentro de um 200', () => {
  it('reconhece {"message": "..."} quando shopping está ausente (ex.: créditos esgotados)', () => {
    expect(serperResponseError({ message: 'Not enough credits' })).toBe('Not enough credits')
  })
  it('reconhece {"error": "..."} quando shopping está ausente', () => {
    expect(serperResponseError({ error: 'invalid query' })).toBe('invalid query')
  })
  it('shopping vazio não é tratado como erro, mesmo com outros campos presentes', () => {
    expect(serperResponseError({ shopping: [], searchParameters: { q: 'x' } })).toBeNull()
  })
  it('shopping presente e não vazio nunca é erro', () => {
    expect(serperResponseError({ shopping: [{ title: 'a' }], message: 'ignorado' })).toBeNull()
  })
})

describe('normalizeShoppingResult: mapeia title/source/link/price/delivery/rating/ratingCount/productId', () => {
  it('normaliza um item completo com link de vendedor (não-google)', () => {
    const result = normalizeShoppingResult({
      title: 'Amouage Guidance 46 100ml', source: 'Harrods', link: 'https://www.harrods.com/product/guidance-46',
      price: '£510.00', delivery: 'Free delivery', imageUrl: 'https://img', rating: 4.7, ratingCount: 89,
      offers: 3, productId: 'abc123', position: 1,
    })
    expect(result).toEqual({
      title: 'Amouage Guidance 46 100ml', seller_name: 'Harrods', price_native: 510, raw_price: '£510.00',
      currency: 'GBP', product_id: 'abc123', source_url: 'https://www.harrods.com/product/guidance-46',
      merchant_url: 'https://www.harrods.com/product/guidance-46',
      delivery: 'Free delivery', rating: 4.7, reviews: 89, availability_status: 'unknown',
      provider: 'serper_google_shopping',
    })
  })

  it('link do próprio Google (agregador) vira source_url mas NUNCA merchant_url', () => {
    const result = normalizeShoppingResult({ title: 'x', link: 'https://www.google.com/shopping/product/123' })
    expect(result.source_url).toBe('https://www.google.com/shopping/product/123')
    expect(result.merchant_url).toBeNull()
  })

  it('link exatamente como o do smoke real (google.com/search?ibp=oshop...) também vira só source_url', () => {
    const result = normalizeShoppingResult({ title: 'x', link: 'https://www.google.com/search?ibp=oshop&q=amouage+guidance+46' })
    expect(result.source_url).toBe('https://www.google.com/search?ibp=oshop&q=amouage+guidance+46')
    expect(result.merchant_url).toBeNull()
  })

  it('link de um vendedor real (não-google) vira source_url E merchant_url — prioridade 1/2 do spec', () => {
    const result = normalizeShoppingResult({ title: 'x', link: 'https://www.nike.com/t/air-max-97-big-kids-shoes' })
    expect(result.source_url).toBe('https://www.nike.com/t/air-max-97-big-kids-shoes')
    expect(result.merchant_url).toBe('https://www.nike.com/t/air-max-97-big-kids-shoes')
  })

  it('preço ausente vira price_native e raw_price null, nunca 0 ou inventado', () => {
    const result = normalizeShoppingResult({ title: 'Perfume sem preço', source: 'Loja X' })
    expect(result.price_native).toBeNull()
    expect(result.raw_price).toBeNull()
    expect(result.currency).toBeNull()
  })

  it('preço em $ (moeda ambígua) não extrai price_native, mesmo com o texto presente', () => {
    const result = normalizeShoppingResult({ title: 'x', price: '$104.97' })
    expect(result.currency).toBeNull()
    expect(result.price_native).toBeNull()
    expect(result.raw_price).toBe('$104.97')
  })

  it('seller ausente vira null, nunca inventado a partir do domínio', () => {
    const result = normalizeShoppingResult({ title: 'x', link: 'https://loja.example/produto' })
    expect(result.seller_name).toBeNull()
  })

  it('link inválido (não é URL http/https) vira source_url e merchant_url null', () => {
    const result = normalizeShoppingResult({ title: 'x', link: 'not-a-url' })
    expect(result.source_url).toBeNull()
    expect(result.merchant_url).toBeNull()
  })

  it('link ausente vira source_url e merchant_url null, nunca um placeholder', () => {
    const result = normalizeShoppingResult({ title: 'x' })
    expect(result.source_url).toBeNull()
    expect(result.merchant_url).toBeNull()
  })

  it('disponibilidade é sempre "unknown" — aparecer no Shopping não é estoque confirmado', () => {
    const result = normalizeShoppingResult({ title: 'x', offers: 5 })
    expect(result.availability_status).toBe('unknown')
  })

  it('sempre identifica o provider como serper_google_shopping', () => {
    expect(normalizeShoppingResult({ title: 'x' }).provider).toBe('serper_google_shopping')
  })

  it('productId numérico é convertido para string, nunca perdido', () => {
    expect(normalizeShoppingResult({ productId: 123 }).product_id).toBe('123')
  })
})

describe('safeSerperError: só os 4 códigos pedidos, nunca expõe chave/stack', () => {
  const httpError = (status:number) => Object.assign(new Error(`http ${status}`), { status })

  it('timeout → SERPER_TIMEOUT', () => expect(safeSerperError(new DOMException('timeout', 'AbortError'))).toMatchObject({ code: 'SERPER_TIMEOUT', httpStatus: 504 }))
  it('401/403 → SERPER_AUTH', () => {
    expect(safeSerperError(httpError(401))).toMatchObject({ code: 'SERPER_AUTH', httpStatus: 502 })
    expect(safeSerperError(httpError(403))).toMatchObject({ code: 'SERPER_AUTH', httpStatus: 502 })
  })
  it('429 → SERPER_RATE_LIMIT', () => expect(safeSerperError(httpError(429))).toMatchObject({ code: 'SERPER_RATE_LIMIT', httpStatus: 503 }))
  it('qualquer outro status (5xx, 400, rede) → SERPER_PROVIDER_ERROR', () => {
    expect(safeSerperError(httpError(500))).toMatchObject({ code: 'SERPER_PROVIDER_ERROR' })
    expect(safeSerperError(httpError(400))).toMatchObject({ code: 'SERPER_PROVIDER_ERROR' })
    expect(safeSerperError(new TypeError('network'))).toMatchObject({ code: 'SERPER_PROVIDER_ERROR' })
  })
  it('só usa os 4 códigos do spec', () => {
    const codes = [httpError(401), httpError(403), httpError(429), httpError(500), httpError(400), new TypeError('x'), new DOMException('t', 'AbortError')]
      .map((error) => safeSerperError(error).code)
    for (const code of codes) expect(['SERPER_AUTH', 'SERPER_RATE_LIMIT', 'SERPER_TIMEOUT', 'SERPER_PROVIDER_ERROR']).toContain(code)
  })
  it('mensagens nunca contêm a palavra "key" nem stack trace', () => {
    for (const status of [401, 403, 429, 500]) {
      const safe = safeSerperError(httpError(status))
      expect(safe.message.toLowerCase()).not.toContain('key')
      expect(safe.message).not.toContain('at ')
    }
  })
})

describe('buildSerperRequestBody: contrato oficial do Serper (POST + body, não query string)', () => {
  it('monta {q, gl, hl} preservando a query literalmente', () => {
    expect(buildSerperRequestBody('Amouage Guidance 46 100ml', { gl: 'uk', hl: 'en' })).toEqual({
      q: 'Amouage Guidance 46 100ml', gl: 'uk', hl: 'en',
    })
  })
})
