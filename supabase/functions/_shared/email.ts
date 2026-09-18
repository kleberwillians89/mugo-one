// Mecânica de envio via Resend, extraída de send-email/index.ts para
// ser reaproveitada pelo automation-worker (briefing §18: "NÃO chamar
// Resend diretamente do Automation Engine" — o worker usa este MESMO
// helper que o fluxo de composição manual usa, nunca uma segunda
// implementação da chamada HTTP).

export type ResendSendResult = { ok: true; providerMessageId: string | null } | { ok: false; errorCode: string; errorMessage: string }

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

export async function sendViaResend(input: { apiKey: string; from: string; to: string; subject: string; text: string }): Promise<ResendSendResult> {
  console.log({ event: 'communication_email_send_start', recipient: maskedEmail(input.to) })
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }),
    })
    const raw = await response.text()
    if (!response.ok) {
      const providerError = safeProviderError(raw)
      console.error({ event: 'communication_email_send_failed', status: response.status, provider_error: providerError })
      return { ok: false, errorCode: `email_${response.status}`, errorMessage: providerError }
    }
    let parsed: { id?: unknown } = {}
    try { parsed = JSON.parse(raw) as { id?: unknown } } catch { /* resposta inesperada tratada abaixo */ }
    const providerMessageId = typeof parsed.id === 'string' ? parsed.id : null
    console.log({ event: 'communication_email_sent', provider_message_id: providerMessageId })
    return { ok: true, providerMessageId }
  } catch {
    console.error({ event: 'communication_email_send_failed', status: 0, provider_error: 'transport_error' })
    return { ok: false, errorCode: 'email_transport_error', errorMessage: 'transport_error' }
  }
}
