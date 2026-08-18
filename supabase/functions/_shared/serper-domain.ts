// Serper (google.serper.dev) Google Shopping: funcoes puras (sem Deno.env, sem fetch) —
// testadas diretamente pelo vitest, nos moldes de superfrete-domain.ts / serpapi-domain.ts.
//
// Contrato oficial do Serper (confirmado antes de implementar, não é o mesmo contrato do
// SerpAPI): POST https://google.serper.dev/shopping, header X-API-KEY, body {q,gl,hl}.
// A resposta traz os resultados em raw.shopping (não "shopping_results" como no SerpAPI).

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
  provider: 'serper_google_shopping'
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
  return Array.isArray(root.shopping) ? (root.shopping as ShoppingResultItem[]) : []
}

// Erro explícito reportado pelo próprio Serper dentro de uma resposta 200 (ex.: creditos
// esgotados costuma vir como {"message":"..."} sem o array shopping). Diferente de
// shopping vazio, que NÃO é erro.
export function serperResponseError(raw: unknown): string | null {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (Array.isArray(root.shopping)) return null
  if (typeof root.message === 'string' && root.message.trim()) return root.message
  if (typeof root.error === 'string' && root.error.trim()) return root.error
  return null
}

// Serper não devolve um campo numérico de preço já extraído (só a string formatada, ex.:
// "£510.00") — extraímos o valor nós mesmos, e SÓ quando a moeda já foi confirmada. Preço
// em '$' sozinho (moeda ambígua) fica sem price_native também, não só sem currency.
function parsePriceNative(priceText: string | null, currency: string | null): number | null {
  if (!priceText || !currency) return null
  const match = priceText.match(/[\d.,]+/)
  if (!match) return null
  const value = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

// O `link` do Serper, diferente do product_link do SerpAPI, costuma já ser a URL de saída
// (frequentemente do próprio vendedor) em vez de sempre uma página do Google Shopping.
// Só tratamos como "claramente domínio do vendedor" quando o host não é do próprio Google -
// nunca inventamos essa confirmação quando o link aponta para google.*/shopping.
function merchantUrlFrom(link: string | null): string | null {
  if (!link) return null
  try {
    const host = new URL(link).hostname.toLowerCase()
    if (host === 'google.com' || host.endsWith('.google.com') || host.includes('google.')) return null
    return link
  } catch {
    return null
  }
}

// Nunca inventa preço, loja, url ou disponibilidade: campos ausentes viram null,
// availability_status é sempre 'unknown' (aparecer no Shopping != ter estoque confirmado).
export function normalizeShoppingResult(item: ShoppingResultItem): NormalizedShoppingOffer {
  const priceText = typeof item.price === 'string' ? item.price : null
  const currency = extractCurrency(priceText)
  const link = validHttpUrl(item.link)
  return {
    title: typeof item.title === 'string' ? item.title : null,
    seller_name: typeof item.source === 'string' ? item.source : null,
    price_native: parsePriceNative(priceText, currency),
    raw_price: priceText,
    currency,
    product_id: typeof item.productId === 'string' ? item.productId : (typeof item.productId === 'number' ? String(item.productId) : null),
    source_url: link,
    merchant_url: merchantUrlFrom(link),
    delivery: typeof item.delivery === 'string' ? item.delivery : null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    reviews: typeof item.ratingCount === 'number' ? item.ratingCount : null,
    availability_status: 'unknown',
    provider: 'serper_google_shopping',
  }
}

export type SafeSerperError = { code: string; message: string; httpStatus: number }

// Só os 4 códigos pedidos: SERPER_AUTH, SERPER_RATE_LIMIT, SERPER_TIMEOUT, SERPER_PROVIDER_ERROR.
// Nunca inclui corpo bruto do provedor, stack trace ou qualquer coisa que possa carregar a chave.
export function safeSerperError(error: unknown): SafeSerperError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'SERPER_TIMEOUT', message: 'A busca demorou mais que o esperado. Tente novamente.', httpStatus: 504 }
  }
  const status = Number((error as { status?: number } | undefined)?.status || 0)
  if (status === 401 || status === 403) return { code: 'SERPER_AUTH', message: 'A busca externa não pôde ser autenticada.', httpStatus: 502 }
  if (status === 429) return { code: 'SERPER_RATE_LIMIT', message: 'A busca externa atingiu o limite. Tente novamente em instantes.', httpStatus: 503 }
  return { code: 'SERPER_PROVIDER_ERROR', message: 'A busca externa não conseguiu concluir esta pesquisa agora.', httpStatus: 502 }
}

export function buildSerperRequestBody(query: string, market: { gl: string; hl: string }) {
  return { q: query, gl: market.gl, hl: market.hl }
}

// Mapeamento explícito entre o mercado interno do Radar e o valor que o Serper de fato
// respeita no parâmetro gl. A documentação oficial do Google (Custom Search JSON API) lista
// "uk" como código de país para o Reino Unido, mas isso NÃO é o que o Serper aceita: o
// primeiro smoke real (gl='uk') devolveu resultados dos EUA (URLs com gl=us, preços em "$"),
// e há relatos da comunidade do mesmo comportamento. O Serper segue ISO 3166-1 alpha-2, cujo
// código para o Reino Unido é "gb" — confirmado como a correção correta antes de aplicar.
// Nunca enviar o código interno direto ao provider sem passar por este mapeamento.
const PROVIDER_MARKET: Record<string, string> = { uk: 'gb' }

export function providerMarketFor(internalMarket: string): string {
  return PROVIDER_MARKET[internalMarket] ?? internalMarket
}
