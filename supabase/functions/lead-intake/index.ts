import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { publicRateLimit } from '../_shared/public-rate-limit.ts'

// CORS aberto de propósito nesta função (diferente de
// customer-registration-start, que restringe a allowedPublicOrigins):
// o Lead Intake precisa aceitar POST tanto de servidor-a-servidor
// (Zapier/Make/n8n/backend próprio) quanto de JS de sites de clientes
// hospedados em domínios que o Mugô One nunca vai conhecer previamente.
// A defesa real aqui é public_key + rate limit + validação de payload,
// não Origin — ver docs/LEAD_INTAKE_MIGRATION_PLAN.md §8 e
// docs/LEAD_INTAKE_API.md.
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...corsHeaders },
})

const maskedEmail = (value: string) => {
  const [local, domain] = String(value ?? '').split('@')
  return local && domain ? `${local[0]}***@${domain}` : 'sem e-mail'
}

function str(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = String(value).trim()
  return s ? s.slice(0, max) : undefined
}

const STATUS_HTTP: Record<string, number> = {
  processed: 200,
  duplicate: 200,
  identity_conflict: 202,
  invalid_key: 401,
  endpoint_disabled: 403,
  invalid_payload: 400,
  failed: 500,
}

const KNOWN_FIELDS = new Set([
  'provider', 'channel', 'external_id', 'idempotency_key', 'name', 'email', 'phone', 'document',
  'company_name', 'interest_catalog_item_id', 'interest', 'source', 'medium',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'form_id', 'form_name', 'landing_page', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'click_id', 'click_id_type', 'occurred_at', 'metadata',
])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, 405)

  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const publicKey = segments[segments.length - 1]
  if (!publicKey || !/^[0-9a-f]{64}$/i.test(publicKey)) {
    return json({ error: { code: 'invalid_intake_key', message: 'Chave de entrada inválida.' } }, 401)
  }

  const rawText = await req.text()
  // Limite de tamanho de payload (briefing §27) — antes até de tentar
  // parsear, evita gastar CPU com corpo gigante.
  if (rawText.length > 65536) return json({ error: { code: 'invalid_payload', message: 'Payload excede o tamanho máximo permitido.' } }, 413)

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawText || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not_object')
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: { code: 'invalid_payload', message: 'JSON inválido.' } }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: { code: 'server_config', message: 'Entrada de leads temporariamente indisponível.' } }, 503)
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const [addressAllowed, keyAllowed] = await Promise.all([
      publicRateLimit({ admin, req, serviceRoleKey: serviceKey, scope: 'lead-intake.ip', limit: 120, windowSeconds: 3600 }),
      publicRateLimit({ admin, req, serviceRoleKey: serviceKey, scope: 'lead-intake.key', identifier: publicKey, includeAddress: false, limit: 600, windowSeconds: 3600 }),
    ])
    if (!addressAllowed || !keyAllowed) return json({ error: { code: 'rate_limit', message: 'Muitas requisições. Aguarde antes de tentar novamente.' } }, 429)
  } catch {
    return json({ error: { code: 'service_unavailable', message: 'Entrada de leads temporariamente indisponível.' } }, 503)
  }

  // Campos desconhecidos vão para metadata controlada — nunca um
  // INSERT direto do JSON bruto (briefing §26).
  const extraMetadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!KNOWN_FIELDS.has(key)) extraMetadata[key] = value
  }
  const baseMetadata = (typeof body.metadata === 'object' && body.metadata && !Array.isArray(body.metadata))
    ? body.metadata as Record<string, unknown>
    : {}
  const metadata = { ...baseMetadata, ...extraMetadata }

  const interestCatalogItemId = str(body.interest_catalog_item_id, 36)
  const validCatalogItemId = interestCatalogItemId && /^[0-9a-f-]{36}$/i.test(interestCatalogItemId) ? interestCatalogItemId : null

  const occurredAtRaw = str(body.occurred_at, 40)
  const occurredAt = occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw)) ? occurredAtRaw : null

  const { data, error } = await admin.rpc('lead_intake_submit', {
    p_public_key: publicKey,
    p_provider: str(body.provider, 80) ?? 'generic_webhook',
    p_channel: str(body.channel, 80) ?? 'website',
    p_external_id: str(body.external_id, 200) ?? null,
    p_idempotency_key: str(body.idempotency_key, 200) ?? null,
    p_name: str(body.name, 200) ?? null,
    p_email: str(body.email, 320) ?? null,
    p_phone: str(body.phone, 40) ?? null,
    p_document: str(body.document, 40) ?? null,
    p_company_name: str(body.company_name, 200) ?? null,
    p_interest_catalog_item_id: validCatalogItemId,
    p_interest_text: str(body.interest, 500) ?? null,
    p_source: str(body.source, 80) ?? null,
    p_medium: str(body.medium, 80) ?? null,
    p_campaign_id: str(body.campaign_id, 200) ?? null,
    p_campaign_name: str(body.campaign_name, 200) ?? null,
    p_adset_id: str(body.adset_id, 200) ?? null,
    p_adset_name: str(body.adset_name, 200) ?? null,
    p_ad_id: str(body.ad_id, 200) ?? null,
    p_ad_name: str(body.ad_name, 200) ?? null,
    p_form_id: str(body.form_id, 200) ?? null,
    p_form_name: str(body.form_name, 200) ?? null,
    p_landing_page: str(body.landing_page, 2000) ?? null,
    p_referrer: str(body.referrer, 2000) ?? null,
    p_utm_source: str(body.utm_source, 200) ?? null,
    p_utm_medium: str(body.utm_medium, 200) ?? null,
    p_utm_campaign: str(body.utm_campaign, 200) ?? null,
    p_utm_term: str(body.utm_term, 200) ?? null,
    p_utm_content: str(body.utm_content, 200) ?? null,
    p_click_id: str(body.click_id, 200) ?? null,
    p_click_id_type: str(body.click_id_type, 40) ?? null,
    p_occurred_at: occurredAt,
    p_metadata: metadata,
    p_raw_payload: body,
  })

  if (error) {
    console.error({ event: 'lead_intake_rpc_failed', code: error.code, message: error.message })
    return json({ error: { code: 'processing_error', message: 'Não foi possível processar a entrada agora.' } }, 500)
  }

  const result = (data ?? {}) as Record<string, unknown>
  console.log({
    event: 'lead_intake_processed', status: result.status, event_id: result.event_id,
    provider: body.provider, channel: body.channel, email_hint: maskedEmail(String(body.email ?? '')),
  })

  // Um lead.created pode ter disparado uma automação com ação
  // send_email, que só ENFILEIRA a message (nenhuma RPC faz HTTP —
  // ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md §5). Acorda o worker
  // sem bloquear a resposta deste webhook (briefing §27 — "não
  // bloquear... esperando e-mail"); se falhar (secret ausente,
  // indisponibilidade), o e-mail continua 'queued', nunca some.
  if (result.status === 'processed') {
    const workerSecret = Deno.env.get('AUTOMATION_WORKER_SECRET')
    if (workerSecret) {
      const wake = fetch(`${supabaseUrl}/functions/v1/automation-worker`, {
        method: 'POST', headers: { 'x-worker-secret': workerSecret },
      }).catch((error) => console.error({ event: 'automation_worker_wake_failed', message: String(error) }))
      // EdgeRuntime.waitUntil mantém a promise viva além da resposta
      // deste request (Deno encerraria a isolate assim que a Response
      // fosse enviada, sem isto) — disponível no runtime da Supabase.
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
      if (runtime) runtime.waitUntil(wake); else await wake
    }
  }

  return json({ data: result }, STATUS_HTTP[String(result.status)] ?? 200)
})
