// RADAR GLOBAL - busca externa de ofertas via SerpAPI Google Shopping.
// Secret usado: SERPAPI_API_KEY (Supabase Function secret). Nunca exposto ao frontend,
// nunca prefixado VITE_, nunca logado (nem em erro, nem em URL de log).
// Sem a chave configurada, a funcao registra a tentativa e responde available:false -
// o restante do Radar (ofertas manuais, watchlist, comparador) continua funcional.
//
// Fase atual (smoke): UMA busca por clique, mercado UK apenas (gl=uk, hl=en).
// Nao executa as demais linguas planejadas para nao gastar quota antes de provar o mercado UK.
// READ-ONLY: nenhuma oferta e gravada em radar_offers a partir desta funcao.
import { context, json, audit } from '../_shared/security.ts'
import { serpApiGoogleShoppingSearch } from '../_shared/serpapi.ts'
import { extractShoppingResults, normalizeShoppingResult, safeSerpApiError, serpApiResponseError } from '../_shared/serpapi-domain.ts'

const MARKET = { gl: 'uk', hl: 'en' } as const

const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const startedAt = Date.now()
  const respond = (body: unknown, status = 200) => json(body, status, req)
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId, role } = ctx

  const brand = String(body.brand ?? '').trim().slice(0, 120)
  const perfumeName = String(body.perfume_name ?? '').trim().slice(0, 160)
  const sizeMl = Number(body.size_ml ?? 0) || null
  const watchItemId = body.watch_item_id ? String(body.watch_item_id) : null
  // A query base preserva EXATAMENTE o texto digitado pelo usuário - nunca é reconstruída
  // a partir de brand/perfume_name/size_ml, o que reordenaria as palavras arbitrariamente.
  const rawQuery = String(body.query ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const query = rawQuery || [brand, perfumeName, sizeMl ? `${sizeMl}ml` : null].filter(Boolean).join(' ')
  if (!brand || !perfumeName || !query) {
    return respond({ error: { code: 'invalid_payload', message: 'Informe marca e nome do perfume.' } }, 400)
  }
  if (!['admin', 'manager', 'operator', 'viewer'].includes(role)) {
    return respond({ error: { code: 'forbidden', message: 'Perfil sem acesso ao radar.' } }, 403)
  }

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await client.from('radar_search_runs').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('run_type', 'search').gte('created_at', since)
  if ((count ?? 0) >= 5) return respond({ error: { code: 'rate_limit', message: 'Limite de buscas atingido. Aguarde um minuto.' } }, 429)

  // Uma ação humana = uma busca: uma requisição idêntica ainda em andamento é recusada em
  // vez de disparar uma segunda chamada à SerpAPI (guarda contra duplo clique/retry de rede).
  const requestHash = await sha256(`${user.id}|${organizationId}|${query.toLowerCase()}|${MARKET.gl}`)
  const { data: duplicate } = await client.from('radar_search_runs').select('id').eq('user_id', user.id)
    .eq('request_hash', requestHash).eq('status', 'running').gte('created_at', since).limit(1).maybeSingle()
  if (duplicate) return respond({ error: { code: 'duplicate_request', message: 'Esta busca já está em andamento.' } }, 409)

  const apiKey = Deno.env.get('SERPAPI_API_KEY')?.trim()
  const provider = apiKey ? 'serpapi_google_shopping' : null

  const run = await client.from('radar_search_runs').insert({
    organization_id: organizationId, user_id: user.id, watch_item_id: watchItemId,
    run_type: 'search', query, provider,
    status: provider ? 'running' : 'not_configured', request_hash: requestHash,
  }).select('id').single()

  await audit(client, organizationId, user.id, 'radar_search_started', 'radar_search_run', run.data?.id, {
    brand, perfume_name: perfumeName, size_ml: sizeMl, query, market: MARKET.gl, provider,
  })

  if (!apiKey) {
    if (run.data?.id) {
      await client.from('radar_search_runs').update({
        status: 'not_configured', duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
      }).eq('id', run.data.id)
    }
    await audit(client, organizationId, user.id, 'radar_search_completed', 'radar_search_run', run.data?.id, {
      status: 'not_configured', result_count: 0,
    })
    return respond({
      data: { available: false, message: 'Busca externa ainda não configurada.', query, market: MARKET.gl, run_id: run.data?.id ?? null },
    })
  }

  const finish = async (status: string, errorCode: string | null) => {
    if (!run.data?.id) return
    await client.from('radar_search_runs').update({
      status, error_code: errorCode, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
    }).eq('id', run.data.id)
  }

  let raw: unknown
  try {
    raw = await serpApiGoogleShoppingSearch(query, MARKET)
  } catch (cause) {
    const safe = safeSerpApiError(cause)
    await finish('failed', safe.code)
    console.error(JSON.stringify({ stage: 'serpapi_fetch', error_code: safe.code, organization_id: organizationId, user_id: user.id, duration_ms: Date.now() - startedAt }))
    return respond({ error: { code: safe.code, message: safe.message } }, safe.httpStatus)
  }

  const providerError = serpApiResponseError(raw)
  if (providerError) {
    await finish('failed', 'SERPAPI_PROVIDER_ERROR')
    console.error(JSON.stringify({ stage: 'serpapi_provider_error', organization_id: organizationId, user_id: user.id }))
    return respond({ error: { code: 'SERPAPI_PROVIDER_ERROR', message: 'A busca externa não conseguiu processar esta pesquisa.' } }, 502)
  }

  // Zero resultados NÃO é erro: shopping_results vazio ou ausente vira lista vazia.
  const results = extractShoppingResults(raw).map(normalizeShoppingResult)

  await finish('completed', null)
  await audit(client, organizationId, user.id, 'radar_search_completed', 'radar_search_run', run.data?.id, {
    status: 'completed', result_count: results.length, market: MARKET.gl,
  })

  // READ-ONLY: nada aqui é gravado em radar_offers. Persistir uma oferta escolhida é uma
  // ação futura e explícita do usuário (botão "Salvar oportunidade"), fora deste smoke.
  return respond({
    data: {
      available: true, provider: 'serpapi_google_shopping', query, market: MARKET.gl,
      result_count: results.length, results, run_id: run.data?.id ?? null,
    },
  })
})
