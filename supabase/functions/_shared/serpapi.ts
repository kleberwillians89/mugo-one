// SerpApi Google Shopping: wrapper de rede (Deno-only). A chave SERPAPI_API_KEY nunca sai
// deste arquivo — nunca e enviada ao frontend, nunca prefixada VITE_, nunca logada.
import { buildSerpApiSearchUrl, redactApiKey } from './serpapi-domain.ts'

export function serpApiConfigured(): boolean {
  return Boolean(Deno.env.get('SERPAPI_API_KEY')?.trim())
}

export async function serpApiGoogleShoppingSearch(query: string, market: { gl: string; hl: string }, timeoutMs = 20000): Promise<unknown> {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')?.trim()
  if (!apiKey) throw new Error('serpapi_not_configured')
  const url = buildSerpApiSearchUrl(query, apiKey, market)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const raw = await response.text()
    let body: unknown = null
    try { body = raw ? JSON.parse(raw) : null } catch { /* resposta não JSON descartada */ }
    if (!response.ok) {
      console.error(JSON.stringify({ stage: 'serpapi_response', status: response.status, url: redactApiKey(url) }))
      const error = new Error(`serpapi_http_${response.status}`) as Error & { status: number }
      error.status = response.status
      throw error
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}
