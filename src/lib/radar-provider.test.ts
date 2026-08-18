import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const search = readFileSync(new URL('../../supabase/functions/radar-search/index.ts', import.meta.url), 'utf8')
const summary = readFileSync(new URL('../../supabase/functions/radar-summary/index.ts', import.meta.url), 'utf8')
const serper = readFileSync(new URL('../../supabase/functions/_shared/serper.ts', import.meta.url), 'utf8')
const serperDomain = readFileSync(new URL('../../supabase/functions/_shared/serper-domain.ts', import.meta.url), 'utf8')
const serperProvider = readFileSync(new URL('../../supabase/functions/_shared/serper-provider.ts', import.meta.url), 'utf8')
const serpapiProvider = readFileSync(new URL('../../supabase/functions/_shared/serpapi-provider.ts', import.meta.url), 'utf8')

describe('radar-search: secret SERPER_API_KEY', () => {
  it('lê o secret pelo nome exato, nunca hardcoded', () => {
    expect(serper).toContain("Deno.env.get('SERPER_API_KEY')")
    expect(search).not.toMatch(/api_key\s*[:=]\s*['"][A-Za-z0-9]/)
  })

  it('nunca é prefixado VITE_ (nunca exposto ao frontend)', () => {
    for (const source of [search, serper, serperDomain]) expect(source).not.toContain('VITE_SERPER')
  })

  it('sem o secret, responde available:false com a mensagem exata do spec', () => {
    expect(search).toContain('Busca externa ainda não configurada.')
    expect(search).toContain('provider.configured()')
  })

  it('a chave vai num header (X-API-KEY), não na URL — nunca aparece em querystring', () => {
    expect(serper).toContain("'x-api-key': apiKey")
    expect(serper).not.toMatch(/[?&]api_key=/)
  })

  it('nunca loga a chave nem o corpo da resposta bruta em erro', () => {
    const errorLogLines = serper.split('\n').filter((line) => /console\.(error|log|warn)/.test(line))
    for (const line of errorLogLines) {
      expect(line).not.toContain('apiKey')
      expect(line).not.toContain('headers')
    }
  })
})

describe('radar-search: SERPAPI_API_KEY não é mais necessária para o provider ativo', () => {
  it('radar-search não importa nada dos módulos serpapi.ts/serpapi-domain.ts', () => {
    expect(search).not.toContain("from '../_shared/serpapi.ts'")
    expect(search).not.toContain("from '../_shared/serpapi-domain.ts'")
    expect(search).not.toContain("from '../_shared/serpapi-provider.ts'")
  })

  it('radar-search nunca lê SERPAPI_API_KEY diretamente (só cita em comentário explicativo)', () => {
    expect(search).not.toContain("Deno.env.get('SERPAPI_API_KEY')")
    expect(search).not.toContain("env.SERPAPI_API_KEY")
  })

  it('o provider ativo selecionado em runtime é o Serper', () => {
    expect(search).toContain("import { SerperGoogleShoppingProvider } from '../_shared/serper-provider.ts'")
    expect(search).toContain('const provider = SerperGoogleShoppingProvider')
  })
})

describe('PerfumeSearchProvider: arquitetura ativo/inativo preservada (código histórico não apagado)', () => {
  it('SerperGoogleShoppingProvider implementa a interface genérica e está ativo', () => {
    expect(serperProvider).toContain("import type { PerfumeSearchProvider } from './perfume-search-provider.ts'")
    expect(serperProvider).toContain("name: 'serper_google_shopping'")
  })

  it('SerpApiGoogleShoppingProvider continua existindo, documentado como inativo/futuro', () => {
    expect(serpapiProvider).toContain('INATIVO/FUTURO')
    expect(serpapiProvider).toContain("name: 'serpapi_google_shopping'")
  })

  it('o provider antigo (SerpAPI) não é importado por nada em runtime ativo', () => {
    expect(search).not.toContain('SerpApiGoogleShoppingProvider')
  })
})

describe('radar-search: query normalization preservada (não reordena)', () => {
  it('a query base vem literalmente do payload do usuário, nunca reconstruída por padrão', () => {
    expect(search).toContain("const rawQuery = String(body.query ?? '')")
    expect(search).toContain('const query = rawQuery ||')
  })

  it('quando reconstrói (fallback sem query explícita), junta brand/perfumeName/size na ordem recebida, nunca embaralha', () => {
    const fallbackLine = search.split('\n').find((line) => line.includes('const query = rawQuery ||'))
    expect(fallbackLine).toContain('[brand, perfumeName, sizeMl')
  })
})

describe('radar-search: mercado UK único, uma chamada por clique', () => {
  it('usa gl=uk e hl=en como mercado fixo desta fase', () => {
    expect(search).toContain("const MARKET = { gl: 'uk', hl: 'en' }")
  })

  it('não existe lógica de múltiplas queries por idioma/país', () => {
    expect(search).not.toContain('LANGUAGE_TEMPLATES')
    expect(search).not.toContain('queries_planned')
  })

  it('faz no máximo uma chamada ao provider por requisição', () => {
    const callCount = (search.match(/provider\.search\(/g) ?? []).length
    expect(callCount).toBe(1)
  })

  it('nunca usa cache desabilitado ou parâmetros de múltiplos mercados', () => {
    for (const source of [search, serper, serperDomain]) expect(source).not.toContain('no_cache')
  })
})

describe('radar-search: mapeamento explícito de mercado (UK → gb no provider)', () => {
  it('nunca envia o código interno direto ao provider — passa por providerMarketFor', () => {
    expect(search).toContain('providerMarketFor')
    expect(search).toContain('const PROVIDER_MARKET = { gl: providerMarketFor(MARKET.gl), hl: MARKET.hl }')
  })

  it('chama o provider com o mercado mapeado (PROVIDER_MARKET), não com o interno (MARKET)', () => {
    expect(search).toContain('provider.search(query, PROVIDER_MARKET)')
    expect(search).not.toContain('provider.search(query, MARKET)')
  })

  it('expõe requested_market e provider_market quando não configurado', () => {
    const notConfiguredBlock = search.slice(search.indexOf('Busca externa ainda não configurada.'), search.indexOf('Busca externa ainda não configurada.') + 200)
    expect(notConfiguredBlock).toContain('requested_market')
    expect(notConfiguredBlock).toContain('provider_market')
  })

  it('expõe requested_market e provider_market na resposta com resultados', () => {
    const successBlock = search.slice(search.indexOf('available: true'))
    expect(successBlock).toContain('requested_market')
    expect(successBlock).toContain('provider_market')
  })
})

describe('radar-search: contrato oficial do Serper (POST /shopping, body q/gl/hl)', () => {
  it('usa o endpoint oficial de shopping', () => {
    expect(serper).toContain("'https://google.serper.dev/shopping'")
  })

  it('é POST com corpo JSON, não GET com querystring (diferente do provider anterior)', () => {
    expect(serper).toContain("method: 'POST'")
  })

  it('lê os resultados de raw.shopping, nunca de shopping_results (contrato do provider anterior)', () => {
    expect(serperDomain).toContain('root.shopping')
    expect(serperDomain).not.toContain('root.shopping_results')
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

describe('radar-search: uma ação humana = uma busca (guarda de quota/créditos)', () => {
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
  it.each(['SERPER_TIMEOUT', 'SERPER_AUTH', 'SERPER_RATE_LIMIT', 'SERPER_PROVIDER_ERROR'])('propaga o código %s sem detalhes internos', (code) => {
    expect(serperDomain).toContain(code)
  })

  it('erro explícito do Serper é tratado separadamente de zero resultados', () => {
    expect(search).toContain('serperResponseError(raw)')
    expect(search).toContain('SERPER_PROVIDER_ERROR')
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

describe('radar-search: classificação de relevância determinística anexada aos resultados (raw != oportunidades)', () => {
  it('classifica relevância e tipo de fonte por resultado, sem IA', () => {
    expect(search).toContain("import { classifyRelevance, classifySourceType, flagPriceOutliers } from '../_shared/relevance-domain.ts'")
    expect(search).toContain('relevance: classifyRelevance(offer.title ?? \'\', canonical)')
    expect(search).toContain('source_type: classifySourceType(offer.seller_name, offer.merchant_url ?? offer.source_url)')
  })

  it('usa a marca/nome/tamanho já parseados do texto literal digitado (não reconstrói)', () => {
    expect(search).toContain('const canonical = { brand, perfumeName, sizeMl }')
  })

  it('sinaliza preço fora da faixa sem excluir a oferta', () => {
    expect(search).toContain('flagPriceOutliers(classified)')
    expect(search).toContain("price_flag: priceFlags[index] ? 'outlier'")
  })

  it('resposta expõe relevant_count separado do result_count bruto (raw != oportunidades)', () => {
    expect(search).toContain('const relevantCount = results.filter((offer) => offer.relevance === \'exact\' || offer.relevance === \'likely\').length')
    expect(search).toContain('relevant_count: relevantCount')
  })

  it('não faz uma segunda chamada de rede por resultado para resolver merchant/produto', () => {
    const callCount = (search.match(/provider\.search\(/g) ?? []).length
    expect(callCount).toBe(1)
    expect(search).not.toMatch(/results\.forEach.*fetch/s)
    expect(search).not.toMatch(/for\s*\(.*results.*\)\s*{[\s\S]*await\s+(fetch|provider\.search)/m)
  })
})

describe('radar-summary: IA recebe apenas agregados determinísticos (inalterado por esta troca de provider)', () => {
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
