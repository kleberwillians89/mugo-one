// RADAR GLOBAL - busca externa de ofertas.
// Nenhuma API key hardcoded. Provider configurado via secrets de Edge Function:
//   RADAR_SEARCH_PROVIDER  (ex.: 'web_search' - ainda nao implementado)
//   RADAR_SEARCH_API_KEY
// Sem provider configurado, a funcao registra a tentativa e responde available:false -
// o restante do Radar (ofertas manuais, watchlist, comparador) continua funcional.
import { context, json, audit } from '../_shared/security.ts'

const LANGUAGE_TEMPLATES: { lang: string; build: (q: string) => string }[] = [
  { lang: 'en', build: (q) => `${q} buy` },
  { lang: 'en', build: (q) => `${q} in stock` },
  { lang: 'fr', build: (q) => `${q} parfum prix` },
  { lang: 'it', build: (q) => `${q} profumo prezzo` },
  { lang: 'es', build: (q) => `${q} perfume precio` },
  { lang: 'de', build: (q) => `${q} parfum kaufen` },
]

function buildQueries(brand: string, perfumeName: string, sizeMl: number | null) {
  const base = [brand, perfumeName, sizeMl ? `${sizeMl}ml` : null].filter(Boolean).join(' ').trim()
  return LANGUAGE_TEMPLATES.map((t) => ({ lang: t.lang, query: t.build(base) }))
}

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
  if (!brand || !perfumeName) {
    return respond({ error: { code: 'invalid_payload', message: 'Informe marca e nome do perfume.' } }, 400)
  }
  if (!['admin', 'manager', 'operator', 'viewer'].includes(role)) {
    return respond({ error: { code: 'forbidden', message: 'Perfil sem acesso ao radar.' } }, 403)
  }

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await client.from('radar_search_runs').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('run_type', 'search').gte('created_at', since)
  if ((count ?? 0) >= 5) return respond({ error: { code: 'rate_limit', message: 'Limite de buscas atingido. Aguarde um minuto.' } }, 429)

  const requestHash = await sha256(`${user.id}|${organizationId}|${brand.toLowerCase()}|${perfumeName.toLowerCase()}|${sizeMl ?? ''}`)
  const queries = buildQueries(brand, perfumeName, sizeMl)

  const provider = Deno.env.get('RADAR_SEARCH_PROVIDER')
  const apiKey = Deno.env.get('RADAR_SEARCH_API_KEY')

  const run = await client.from('radar_search_runs').insert({
    organization_id: organizationId, user_id: user.id, watch_item_id: watchItemId,
    run_type: 'search', query: `${brand} ${perfumeName}`.trim(), provider: provider ?? null,
    status: provider && apiKey ? 'running' : 'not_configured', request_hash: requestHash,
  }).select('id').single()

  await audit(client, organizationId, user.id, 'radar_search_started', 'radar_search_run', run.data?.id, {
    brand, perfume_name: perfumeName, size_ml: sizeMl, provider: provider ?? null,
  })

  if (!provider || !apiKey) {
    if (run.data?.id) {
      await client.from('radar_search_runs').update({
        status: 'not_configured', duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
      }).eq('id', run.data.id)
    }
    await audit(client, organizationId, user.id, 'radar_search_completed', 'radar_search_run', run.data?.id, {
      status: 'not_configured', offers_found: 0,
    })
    return respond({
      data: {
        available: false,
        message: 'Busca externa ainda não configurada.',
        queries_planned: queries,
        run_id: run.data?.id ?? null,
      },
    })
  }

  // Nenhum provider real esta integrado ainda (nenhuma API foi escolhida/contratada).
  // O ponto de extensao fica aqui: um adapter real deve popular `offers` respeitando o
  // shape de radar_offers e chamar radar_save_manual_offer (ou equivalente em lote) por item,
  // sempre exigindo url, preco, moeda e pais - nunca inventando esses campos.
  if (run.data?.id) {
    await client.from('radar_search_runs').update({
      status: 'failed', error_code: 'PROVIDER_NOT_IMPLEMENTED',
      duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
    }).eq('id', run.data.id)
  }
  return respond({ error: { code: 'PROVIDER_NOT_IMPLEMENTED', message: 'Provider de busca configurado, mas ainda sem integração ativa.' } }, 501)
})
