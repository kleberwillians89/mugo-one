import { describe, expect, it } from 'vitest'
import {
  buildSerpApiSearchUrl, extractCurrency, extractShoppingResults, normalizeShoppingResult,
  redactApiKey, safeSerpApiError, serpApiResponseError,
} from '../../supabase/functions/_shared/serpapi-domain'

describe('extractCurrency: nunca inventa moeda ambígua', () => {
  it('reconhece GBP pelo símbolo £', () => expect(extractCurrency('£245.00')).toBe('GBP'))
  it('reconhece GBP pelo código explícito', () => expect(extractCurrency('245.00 GBP')).toBe('GBP'))
  it('não confirma moeda para $ (ambíguo entre USD/CAD/AUD/etc.)', () => expect(extractCurrency('$245.00')).toBeNull())
  it('não confirma moeda quando o preço é ausente', () => expect(extractCurrency(undefined)).toBeNull())
  it('não confirma moeda quando o preço é uma string vazia', () => expect(extractCurrency('')).toBeNull())
})

describe('extractShoppingResults: zero resultados nunca é erro', () => {
  it('lê o array quando presente', () => {
    expect(extractShoppingResults({ shopping_results: [{ title: 'a' }] })).toEqual([{ title: 'a' }])
  })
  it('retorna lista vazia quando shopping_results está ausente', () => {
    expect(extractShoppingResults({})).toEqual([])
  })
  it('retorna lista vazia para payload nulo/indefinido', () => {
    expect(extractShoppingResults(null)).toEqual([])
    expect(extractShoppingResults(undefined)).toEqual([])
  })
})

describe('serpApiResponseError: erro explícito da própria SerpAPI', () => {
  it('reconhece {"error": "..."} dentro de um 200', () => {
    expect(serpApiResponseError({ error: 'Google Shopping is not available for this query' })).toBe('Google Shopping is not available for this query')
  })
  it('shopping_results vazio não é tratado como erro', () => {
    expect(serpApiResponseError({ shopping_results: [] })).toBeNull()
  })
})

describe('normalizeShoppingResult: nunca inventa preço, loja, url ou disponibilidade', () => {
  it('normaliza um item completo', () => {
    const result = normalizeShoppingResult({
      title: 'Amouage Guidance 46 100ml', source: 'Harrods', price: '£245.00', extracted_price: 245,
      product_id: 'abc123', product_link: 'https://www.google.com/shopping/product/abc123',
      delivery: 'Free delivery', rating: 4.6, reviews: 120,
    })
    expect(result).toEqual({
      title: 'Amouage Guidance 46 100ml', seller_name: 'Harrods', price_native: 245, raw_price: '£245.00',
      currency: 'GBP', product_id: 'abc123', source_url: 'https://www.google.com/shopping/product/abc123',
      merchant_url: null, delivery: 'Free delivery', rating: 4.6, reviews: 120, availability_status: 'unknown',
    })
  })

  it('preço ausente vira null, nunca 0 ou inventado', () => {
    const result = normalizeShoppingResult({ title: 'Perfume sem preço', source: 'Loja X' })
    expect(result.price_native).toBeNull()
    expect(result.raw_price).toBeNull()
    expect(result.currency).toBeNull()
  })

  it('link ausente vira source_url null, nunca um placeholder', () => {
    const result = normalizeShoppingResult({ title: 'Sem link', source: 'Loja X' })
    expect(result.source_url).toBeNull()
    expect(result.merchant_url).toBeNull()
  })

  it('disponibilidade é sempre "unknown" — aparecer no Shopping não é estoque confirmado', () => {
    const result = normalizeShoppingResult({ title: 'Qualquer', badge: 'In stock', extensions: ['In stock'] })
    expect(result.availability_status).toBe('unknown')
  })

  it('extracted_price como string numérica ainda é convertido', () => {
    expect(normalizeShoppingResult({ extracted_price: '99.90' }).price_native).toBe(99.9)
  })

  it('extracted_price inválido vira null, não NaN', () => {
    expect(normalizeShoppingResult({ extracted_price: 'not-a-number' }).price_native).toBeNull()
  })
})

describe('safeSerpApiError: erro seguro, nunca expõe chave/stack', () => {
  const httpError = (status:number) => Object.assign(new Error(`http ${status}`), { status })

  it('timeout', () => expect(safeSerpApiError(new DOMException('timeout', 'AbortError'))).toMatchObject({ code: 'SERPAPI_TIMEOUT', httpStatus: 504 }))
  it('401/403 → SERPAPI_AUTH sem detalhes do provedor', () => {
    expect(safeSerpApiError(httpError(401))).toMatchObject({ code: 'SERPAPI_AUTH', httpStatus: 502 })
    expect(safeSerpApiError(httpError(403))).toMatchObject({ code: 'SERPAPI_AUTH', httpStatus: 502 })
  })
  it('429 → SERPAPI_RATE_LIMIT', () => expect(safeSerpApiError(httpError(429))).toMatchObject({ code: 'SERPAPI_RATE_LIMIT', httpStatus: 503 }))
  it('500 → erro genérico de rede/provedor', () => expect(safeSerpApiError(httpError(500))).toMatchObject({ code: 'SERPAPI_HTTP_500', httpStatus: 502 }))
  it('sem status conhecido → SERPAPI_NETWORK_ERROR', () => expect(safeSerpApiError(new TypeError('network'))).toMatchObject({ code: 'SERPAPI_NETWORK_ERROR' }))
  it('mensagens nunca contêm a palavra "key" nem stack trace', () => {
    for (const status of [401, 403, 429, 500]) {
      const safe = safeSerpApiError(httpError(status))
      expect(safe.message.toLowerCase()).not.toContain('key')
      expect(safe.message).not.toContain('at ')
    }
  })
})

describe('buildSerpApiSearchUrl e redactApiKey: a chave nunca aparece em log', () => {
  it('monta a URL com engine=google_shopping e mercado UK', () => {
    const url = buildSerpApiSearchUrl('Amouage Guidance 46 100ml', 'secret-key-123', { gl: 'uk', hl: 'en' })
    expect(url).toContain('engine=google_shopping')
    expect(url).toContain('gl=uk')
    expect(url).toContain('hl=en')
    expect(url).toContain('q=Amouage+Guidance+46+100ml')
  })

  it('redactApiKey nunca deixa a chave visível para log', () => {
    const url = buildSerpApiSearchUrl('perfume', 'super-secret-key', { gl: 'uk', hl: 'en' })
    const redacted = redactApiKey(url)
    expect(redacted).not.toContain('super-secret-key')
    expect(redacted).toContain('api_key=REDACTED')
  })
})
