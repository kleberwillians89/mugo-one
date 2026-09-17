import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { constantTimeEqual } from '../_shared/manychat.ts'

// Webhook público de status de provider (briefing §40). Recebe hoje só
// o formato do Resend (Svix), mas o handler já resolve por
// provider+provider_message_id — o mesmo shape serve para outro
// provider assinado por Svix no futuro sem mudar o Core.
//
// NUNCA confia em organization_id do payload: update_message_delivery_status
// resolve a organização a partir da própria message já existente
// (achada por provider_message_id), nunca do corpo recebido.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function base64Decode(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function verifySvixSignature(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false
  // Timestamp fora de uma janela razoável (5 min) — proteção simples
  // contra replay de um payload capturado antigo.
  const timestampSeconds = Number(svixTimestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false

  const secretBytes = base64Decode(secret.replace(/^whsec_/, ''))
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = base64Encode(new Uint8Array(signature))

  const candidates = svixSignature.split(' ').map((part) => part.split(',')[1]).filter(Boolean)
  return candidates.some((candidate) => constantTimeEqual(candidate, expected))
}

const RESEND_STATUS_MAP: Record<string, string | null> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'read',
  'email.bounced': 'failed',
  'email.complained': 'failed',
  'email.delivery_delayed': null,
  'email.clicked': null,
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed' } }, 405)

  const rawText = await req.text()
  if (rawText.length > 65536) return json({ error: { code: 'invalid_payload' } }, 413)

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) return json({ error: { code: 'server_config' } }, 503)

  const verified = await verifySvixSignature(rawText, req.headers, secret)
  if (!verified) return json({ error: { code: 'invalid_signature' } }, 401)

  let event: { type?: string; data?: { email_id?: string } }
  try { event = JSON.parse(rawText) } catch { return json({ error: { code: 'invalid_payload' } }, 400) }

  const providerMessageId = event.data?.email_id
  const status = event.type ? RESEND_STATUS_MAP[event.type] : undefined
  if (!providerMessageId || status === undefined) {
    // Tipo de evento que não mapeamos para um status do Core — recebido
    // e confirmado (200), mas sem efeito. Nunca 4xx para um evento
    // válido só porque ainda não temos um mapeamento (evita retries
    // infinitos do provider por um tipo que nunca vamos processar).
    return json({ data: { status: 'ignored' } }, 200)
  }
  if (status === null) return json({ data: { status: 'ignored' } }, 200)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: { code: 'server_config' } }, 503)
  const admin = createClient(supabaseUrl, serviceKey)

  const { data, error } = await admin.rpc('update_message_delivery_status', {
    p_provider: 'resend',
    p_provider_message_id: providerMessageId,
    p_status: status,
  })
  if (error) {
    console.error({ event: 'communication_webhook_update_failed', provider: 'resend', code: error.code })
    return json({ error: { code: 'processing_error' } }, 500)
  }

  console.log({ event: 'communication_webhook_processed', provider: 'resend', status: (data as { status?: string })?.status })
  return json({ data }, 200)
})
