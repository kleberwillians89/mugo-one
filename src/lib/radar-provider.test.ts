import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const search = readFileSync(new URL('../../supabase/functions/radar-search/index.ts', import.meta.url), 'utf8')
const summary = readFileSync(new URL('../../supabase/functions/radar-summary/index.ts', import.meta.url), 'utf8')
const serpapi = readFileSync(new URL('../../supabase/functions/_shared/serpapi.ts', import.meta.url), 'utf8')
const serpapiDomain = readFileSync(new URL('../../supabase/functions/_shared/serpapi-domain.ts', import.meta.url), 'utf8')

describe('radar-search: secret SERPAPI_API_KEY', () => {
  it('lê o secret pelo nome exato, nunca hardcoded', () => {
    expect(serpapi).toContain("Deno.env.get('SERPAPI_API_KEY')")
    expect(search).not.toMatch(/api_key\s*[:=]\s*['"][A-Za-z0-9]/)
  })

  it('nunca é prefixado VITE_ (nunca exposto ao frontend)', () => {
    for (const source of [search, serpapi, serpapiDomain]) expect(source).not.toContain('VITE_SERPAPI')
  })

  it('sem o secret, responde available:false com a mensagem exata do spec', () => {
    expect(search).toContain('Busca externa ainda não configurada.')
    expect(search).toContain('const apiKey = Deno.env.get')
  })

  it('nunca loga a chave: toda linha de log que menciona a URL passa por redactApiKey', () => {
    expect(serpapi).toContain('redactApiKey(url)')
    const logLinesWithUrl = serpapi.split('\n').filter((line) => /console\.(error|log|warn)/.test(line) && line.includes('url'))
    expect(logLinesWithUrl.length).toBeGreaterThan(0)
    for (const line of logLinesWithUrl) expect(line).toContain('redactApiKey')
  })
})

describe('radar-search: query normalization preservada', () => {
  it('a query base vem literalmente do payload do usuário, nunca reconstruída por padrão', () => {
    expect(search).toContain("const rawQuery = String(body.query ?? '')")
    expect(search).toContain('const query = rawQuery ||')
  })

  it('quando reconstrói (fallback sem query explícita), não reordena: junta brand, perfumeName e size na ordem recebida', () => {
    const fallbackLine = search.split('\n').find((line) => line.includes('const query = rawQuery ||'))
    expect(fallbackLine).toContain('[brand, perfumeName, sizeMl')
  })
})

describe('radar-search: mercado UK único, sem executar as 6 queries planejadas', () => {
  it('usa gl=uk e hl=en como mercado fixo desta fase', () => {
    expect(search).toContain("const MARKET = { gl: 'uk', hl: 'en' }")
  })

  it('não existe mais lógica de múltiplas queries por idioma', () => {
    expect(search).not.toContain('LANGUAGE_TEMPLATES')
    expect(search).not.toContain('queries_planned')
  })

  it('faz no máximo uma chamada de busca por requisição', () => {
    const callCount = (search.match(/serpApiGoogleShoppingSearch\(/g) ?? []).length
    expect(callCount).toBe(1)
  })

  it('nunca usa no_cache=true', () => {
    for (const source of [search, serpapi, serpapiDomain]) expect(source).not.toContain('no_cache')
  })
})

describe('radar-search: engine=google_shopping', () => {
  it('usa o endpoint e engine corretos', () => {
    expect(serpapiDomain).toContain("new URL('https://serpapi.com/search')")
    expect(serpapiDomain).toContain("url.searchParams.set('engine', 'google_shopping')")
  })
})

describe('radar-search: leitura read-only, zero escrita em radar_offers', () => {
  it('nunca grava em radar_offers a partir desta função', () => {
    expect(search).not.toContain("from('radar_offers')")
    expect(search).not.toMatch(/radar_save_manual_offer/)
  })

  it('só grava bookkeeping em radar_search_runs', () => {
    expect(search).toContain("client.from('radar_search_runs').insert")
    expect(search).toContain("client.from('radar_search_runs').update")
  })
})

describe('radar-search: uma ação humana = uma busca (guarda de quota)', () => {
  it('bloqueia requisições duplicadas em andamento (double click / retry)', () => {
    expect(search).toContain(".eq('status', 'running')")
    expect(search).toContain("'duplicate_request'")
  })

  it('mantém o limite de taxa por usuário', () => {
    expect(search).toContain("run_type', 'search'")
    expect(search).toContain("'rate_limit'")
  })
})

describe('radar-search: erros tratados com segurança', () => {
  it.each(['SERPAPI_TIMEOUT', 'SERPAPI_AUTH', 'SERPAPI_RATE_LIMIT'])('propaga o código %s sem detalhes internos', (code) => {
    expect(serpapiDomain).toContain(code)
  })

  it('erro explícito da SerpAPI é tratado separadamente de zero resultados', () => {
    expect(search).toContain('serpApiResponseError(raw)')
    expect(search).toContain('SERPAPI_PROVIDER_ERROR')
  })

  it('zero resultados não é tratado como erro', () => {
    expect(search).toContain('Zero resultados NÃO é erro')
    expect(search).toContain('extractShoppingResults(raw).map(normalizeShoppingResult)')
  })

  it('usa o contexto compartilhado de autenticação/tenant', () => {
    expect(search).toContain("import { context, json, audit } from '../_shared/security.ts'")
    expect(search).toContain('const ctx = await context(req)')
  })
})

describe('radar-summary: IA recebe apenas agregados determinísticos (inalterado)', () => {
  it('usa o contexto compartilhado de autenticação/tenant', () => {
    expect(summary).toContain("import { context, json, audit } from '../_shared/security.ts'")
    expect(summary).toContain('const ctx = await context(req)')
  })

  it('busca agregados via RPC antes de qualquer chamada de IA', () => {
    const rpcIdx = summary.indexOf("client.rpc('radar_offer_aggregates'")
    const fetchIdx = summary.indexOf("fetch('https://api.openai.com")
    expect(rpcIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(rpcIdx)
  })

  it('nunca envia radar_offers cru para o modelo, apenas agregados_autorizados', () => {
    expect(summary).toContain('agregados_autorizados')
    expect(summary).not.toContain("from('radar_offers')")
  })

  it('degrada graciosamente sem chave de IA configurada', () => {
    expect(summary).toContain("Deno.env.get('OPENAI_API_KEY')")
    expect(summary).toContain('OPENAI_SECRET_MISSING')
  })
})
