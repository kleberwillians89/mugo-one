// SerpApi Google Shopping: funcoes puras (sem Deno.env, sem fetch) — testadas diretamente
// pelo vitest, nos moldes de _shared/superfrete-domain.ts.

export type ShoppingResultItem = Record<string, unknown>

export type NormalizedShoppingOffer = {
  title: string | null
  seller_name: string | null
  price_native: number | null
  raw_price: string | null
  currency: string | null
  product_id: string | null
  source_url: string | null
  merchant_url: string | null
  delivery: string | null
  rating: number | null
  reviews: number | null
  availability_status: 'unknown'
}

// So confirma GBP quando o texto do preco traz o simbolo/codigo explicitamente.
// Qualquer outro caso (inclusive '$', ambiguo entre USD/CAD/AUD/etc.) fica null -
// nunca inventamos moeda.
export function extractCurrency(priceText?: string | null): string | null {
  if (!priceText) return null
  if (/£|GBP/i.test(priceText)) return 'GBP'
  return null
}

export function extractShoppingResults(raw: unknown): ShoppingResultItem[] {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Array.isArray(root.shopping_results) ? (root.shopping_results as ShoppingResultItem[]) : []
}

// Erro explicito reportado pela propria SerpAPI dentro de um 200 (ex.: {"error":"..."}).
// Diferente de shopping_results vazio, que NAO e erro.
export function serpApiResponseError(raw: unknown): string | null {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return typeof root.error === 'string' && root.error.trim() ? root.error : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

// Nunca inventa preco, loja, url ou disponibilidade: campos ausentes viram null,
// availability_status e sempre 'unknown' (aparecer no Google Shopping != ter estoque confirmado).
export function normalizeShoppingResult(item: ShoppingResultItem): NormalizedShoppingOffer {
  const priceText = typeof item.price === 'string' ? item.price : null
  return {
    title: typeof item.title === 'string' ? item.title : null,
    seller_name: typeof item.source === 'string' ? item.source : null,
    price_native: numberOrNull(item.extracted_price),
    raw_price: priceText,
    currency: extractCurrency(priceText),
    product_id: typeof item.product_id === 'string' ? item.product_id : null,
    // product_link da SerpAPI pode ser uma pagina do proprio Google Shopping, nao a loja.
    source_url: typeof item.product_link === 'string' ? item.product_link : null,
    merchant_url: null,
    delivery: typeof item.delivery === 'string' ? item.delivery : null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    reviews: typeof item.reviews === 'number' ? item.reviews : null,
    availability_status: 'unknown',
  }
}

export type SafeSerpApiError = { code: string; message: string; httpStatus: number }

export function safeSerpApiError(error: unknown): SafeSerpApiError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'SERPAPI_TIMEOUT', message: 'A busca demorou mais que o esperado. Tente novamente.', httpStatus: 504 }
  }
  const status = Number((error as { status?: number } | undefined)?.status || 0)
  if (status === 401 || status === 403) return { code: 'SERPAPI_AUTH', message: 'A busca externa não pôde ser autenticada.', httpStatus: 502 }
  if (status === 429) return { code: 'SERPAPI_RATE_LIMIT', message: 'A busca externa atingiu o limite. Tente novamente em instantes.', httpStatus: 503 }
  if (status >= 400 && status < 500) return { code: `SERPAPI_HTTP_${status}`, message: 'A busca externa recusou a solicitação.', httpStatus: 502 }
  return { code: status ? `SERPAPI_HTTP_${status}` : 'SERPAPI_NETWORK_ERROR', message: 'Não foi possível concluir a busca agora.', httpStatus: 502 }
}

export function buildSerpApiSearchUrl(query: string, apiKey: string, market: { gl: string; hl: string }): string {
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_shopping')
  url.searchParams.set('q', query)
  url.searchParams.set('gl', market.gl)
  url.searchParams.set('hl', market.hl)
  url.searchParams.set('api_key', apiKey)
  return url.toString()
}

// Usado sempre que a URL de busca precisar aparecer em log — a chave nunca e logada.
export function redactApiKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]+/i, '$1REDACTED')
}
