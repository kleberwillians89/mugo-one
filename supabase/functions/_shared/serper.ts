// Serper (google.serper.dev) Google Shopping: wrapper de rede (Deno-only). A chave
// SERPER_API_KEY nunca sai deste arquivo — nunca vai ao frontend, nunca prefixada VITE_,
// nunca logada (nem em headers, nem em erro). Diferente do SerpAPI, a chave do Serper vai
// num header (X-API-KEY), não na URL — então não há URL com segredo para redigir aqui.
import { buildSerperRequestBody } from './serper-domain.ts'

export function serperConfigured(): boolean {
  return Boolean(Deno.env.get('SERPER_API_KEY')?.trim())
}

export async function serperGoogleShoppingSearch(query: string, market: { gl: string; hl: string }, timeoutMs = 20000): Promise<unknown> {
  const apiKey = Deno.env.get('SERPER_API_KEY')?.trim()
  if (!apiKey) throw new Error('serper_not_configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(buildSerperRequestBody(query, market)),
    })
    const raw = await response.text()
    let body: unknown = null
    try { body = raw ? JSON.parse(raw) : null } catch { /* resposta não JSON descartada */ }
    if (!response.ok) {
      console.error(JSON.stringify({ stage: 'serper_response', status: response.status }))
      const error = new Error(`serper_http_${response.status}`) as Error & { status: number }
      error.status = response.status
      throw error
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}
