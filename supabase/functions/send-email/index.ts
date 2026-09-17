import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, context, json } from '../_shared/security.ts'

// ResendEmailAdapter — mesma mecânica HTTP já comprovada em
// _shared/customer-invite.ts::sendInviteEmail (endpoint, header de
// auth, extração de provider_message_id, mascaramento de erro), mas
// genérico: sem assunto/HTML fixos, sem branding — o conteúdo vem de
// quem chama (ver docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §3).
//
// §41: nesta primeira versão, Mugô usa UMA conta Resend compartilhada
// (RESEND_API_KEY do ambiente da função) — cada organização continua
// logicamente isolada via organization_id em conversations/messages,
// nunca por uma chave de API diferente. Se uma organização precisar de
// conta própria no futuro, communication_connections.credentials_reference
// passa a apontar para um env var específico dela; a mecânica de envio
// abaixo não muda.

const maskedEmail = (value: string) => {
  const [local, domain] = String(value ?? '').split('@')
  return local && domain ? `${local[0]}***@${domain}` : 'e-mail inválido'
}

const safeProviderError = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; name?: unknown }
    const value = typeof parsed.message === 'string' ? parsed.message : typeof parsed.name === 'string' ? parsed.name : ''
    return value.replace(/[\r\n]/g, ' ').slice(0, 180) || 'provider_rejected_request'
  } catch { return 'provider_rejected_request' }
}

Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response

  const channel = String(ctx.body.channel ?? 'email')
  if (channel !== 'email') return json({ error: { code: 'unsupported_channel', message: 'Este endpoint só envia e-mail nesta sprint.' } }, 400, req)

  const subject = String(ctx.body.subject ?? '').trim()
  const bodyText = String(ctx.body.body_text ?? '').trim()
  if (!subject || !bodyText) return json({ error: { code: 'invalid_payload', message: 'Assunto e mensagem são obrigatórios.' } }, 400, req)

  const connectionId = ctx.body.connection_id ? String(ctx.body.connection_id) : null
  const customerId = ctx.body.customer_id ? String(ctx.body.customer_id) : null
  const companyId = ctx.body.company_id ? String(ctx.body.company_id) : null
  const contactId = ctx.body.contact_id ? String(ctx.body.contact_id) : null
  const leadId = ctx.body.lead_id ? String(ctx.body.lead_id) : null
  const conversationId = ctx.body.conversation_id ? String(ctx.body.conversation_id) : null
  const recipientOverride = ctx.body.recipient_identity ? String(ctx.body.recipient_identity).trim() : null

  const { data: sendResult, error: sendError } = await ctx.client.rpc('send_communication_message', {
    p_organization_id: ctx.organizationId,
    p_channel: 'email',
    p_connection_id: connectionId,
    p_customer_id: customerId,
    p_company_id: companyId,
    p_contact_id: contactId,
    p_lead_id: leadId,
    p_conversation_id: conversationId,
    p_recipient_identity: recipientOverride,
    p_subject: subject,
    p_body_text: bodyText,
    p_provider: 'resend',
  })
  if (sendError) {
    const code = sendError.message?.includes('recipient_required') ? 'recipient_required'
      : sendError.message?.includes('forbidden') ? 'forbidden'
      : sendError.message?.includes('message_body_required') ? 'invalid_payload'
      : 'processing_error'
    const status = code === 'forbidden' ? 403 : code === 'processing_error' ? 500 : 422
    return json({ error: { code, message: 'Não foi possível preparar o envio.' } }, status, req)
  }

  const { conversation_id: newConversationId, message_id: messageId, recipient_identity: recipient, sender_identity: senderEmail } = sendResult as {
    conversation_id: string; message_id: string; recipient_identity: string; sender_identity: string | null
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromAddress = senderEmail || Deno.env.get('COMMUNICATIONS_EMAIL_FROM')
  if (!supabaseUrl || !serviceKey) return json({ error: { code: 'server_config', message: 'Comunicação temporariamente indisponível.' } }, 503, req)
  const admin = createClient(supabaseUrl, serviceKey)

  if (!resendKey || !fromAddress) {
    await admin.rpc('update_message_delivery_status', { p_message_id: messageId, p_status: 'failed', p_error_code: 'not_configured', p_error_message: 'Remetente ou chave do Resend não configurados.' })
    return json({ error: { code: 'not_configured', message: 'Conexão de e-mail não está configurada.' } }, 503, req)
  }

  console.log({ event: 'communication_email_send_start', organization_id: ctx.organizationId, conversation_id: newConversationId, message_id: messageId, recipient: maskedEmail(recipient) })

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to: [recipient], subject, text: bodyText }),
    })
    const raw = await response.text()
    if (!response.ok) {
      const providerError = safeProviderError(raw)
      console.error({ event: 'communication_email_send_failed', organization_id: ctx.organizationId, message_id: messageId, status: response.status, provider_error: providerError })
      await admin.rpc('update_message_delivery_status', { p_message_id: messageId, p_status: 'failed', p_error_code: `email_${response.status}`, p_error_message: providerError })
      return json({ error: { code: 'provider_rejected', message: 'O provedor de e-mail recusou o envio.' } }, 502, req)
    }
    let parsed: { id?: unknown } = {}
    try { parsed = JSON.parse(raw) as { id?: unknown } } catch { /* resposta inesperada tratada abaixo */ }
    const providerMessageId = typeof parsed.id === 'string' ? parsed.id : null
    await admin.rpc('update_message_delivery_status', { p_message_id: messageId, p_status: 'sent', p_provider_message_id: providerMessageId })
    await audit(ctx.client, ctx.organizationId, ctx.user.id, 'communication_email_sent', 'conversation', newConversationId, { message_id: messageId, provider: 'resend' })
    console.log({ event: 'communication_email_sent', organization_id: ctx.organizationId, message_id: messageId, provider_message_id: providerMessageId })
    return json({ data: { conversation_id: newConversationId, message_id: messageId, status: 'sent' } }, 200, req)
  } catch {
    console.error({ event: 'communication_email_send_failed', organization_id: ctx.organizationId, message_id: messageId, status: 0, provider_error: 'transport_error' })
    await admin.rpc('update_message_delivery_status', { p_message_id: messageId, p_status: 'failed', p_error_code: 'email_transport_error' })
    return json({ error: { code: 'transport_error', message: 'Não foi possível conectar ao provedor de e-mail agora.' } }, 502, req)
  }
})
