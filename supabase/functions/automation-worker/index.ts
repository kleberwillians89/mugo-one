import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendViaResend } from '../_shared/email.ts'
import { constantTimeEqual } from '../_shared/manychat.ts'

// automation-worker (briefing §26/§73): processa messages que ficaram
// 'queued' após uma automação rodar send_email (a RPC só enfileira —
// nunca faz HTTP, ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md §5).
// NÃO é um endpoint público aberto — protegido por segredo
// compartilhado no header, mesmo padrão de whatsapp-customer-balance.
// NÃO é cron: invocado sob demanda pelos pontos de entrada que já
// causam envio de automação (ex.: lead-intake), nunca por polling.
//
// "claim" via SELECT ... FOR UPDATE SKIP LOCKED (briefing §29 —
// dois workers nunca processam a mesma message ao mesmo tempo).

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed' } }, 405)

  const secret = Deno.env.get('AUTOMATION_WORKER_SECRET')
  const provided = req.headers.get('x-worker-secret') ?? ''
  if (!secret || !constantTimeEqual(provided, secret)) return json({ error: { code: 'unauthorized' } }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: { code: 'server_config' } }, 503)
  const admin = createClient(supabaseUrl, serviceKey)

  // Lote pequeno e síncrono — nada de fila distribuída nesta sprint.
  const { data: claimed, error: claimError } = await admin.rpc('claim_queued_messages', { p_limit: 20 })
  if (claimError) {
    console.error({ event: 'automation_worker_claim_failed', code: claimError.code })
    return json({ error: { code: 'processing_error' } }, 500)
  }

  const rows = (claimed ?? []) as Array<{ id: string; conversation_id: string; recipient_identity: string | null; sender_identity: string | null; body_text: string | null; subject: string | null; organization_id: string }>
  let sent = 0
  let failed = 0

  for (const row of rows) {
    if (!resendKey || !row.sender_identity || !row.recipient_identity) {
      await admin.rpc('update_message_delivery_status', { p_message_id: row.id, p_status: 'failed', p_error_code: 'not_configured', p_error_message: 'Remetente, destinatário ou chave do Resend ausente.' })
      failed++
      continue
    }
    const result = await sendViaResend({ apiKey: resendKey, from: row.sender_identity, to: row.recipient_identity, subject: row.subject ?? '(sem assunto)', text: row.body_text ?? '' })
    if (result.ok) {
      await admin.rpc('update_message_delivery_status', { p_message_id: row.id, p_status: 'sent', p_provider_message_id: result.providerMessageId })
      sent++
    } else {
      await admin.rpc('update_message_delivery_status', { p_message_id: row.id, p_status: 'failed', p_error_code: result.errorCode, p_error_message: result.errorMessage })
      failed++
    }
  }

  console.log({ event: 'automation_worker_processed', claimed: rows.length, sent, failed })
  return json({ data: { claimed: rows.length, sent, failed } }, 200)
})
