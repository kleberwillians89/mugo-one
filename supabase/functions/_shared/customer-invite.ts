export type InviteChannels = { email: boolean; whatsapp: boolean }
export type DeliveryResult = { status: 'sent' | 'failed' | 'not_configured' | 'unavailable'; error?: string }

const cleanPhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 ? (digits.startsWith('55') ? digits : `55${digits}`) : ''
}

export async function sendInviteEmail(input: { to: string; name: string; actionLink: string }): Promise<DeliveryResult> {
  const token = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RUAH_INVITE_FROM') ?? 'RUAH Parfums <contato@ruahparfums.com.br>'
  if (!token) return { status: 'not_configured' }
  const html = `<!doctype html><html><body style="margin:0;background:#f5f1e8;color:#1d1b18;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e5dccd"><tr><td style="padding:42px 34px"><p style="margin:0 0 24px;color:#9a7627;font-size:11px;letter-spacing:3px">RUAH · MINHA RUAH</p><h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:32px;font-weight:normal">Seu espaço privado na RUAH.</h1><p style="line-height:1.7">Olá, ${escapeHtml(input.name)}.</p><p style="line-height:1.7;color:#625b50">Criamos seu acesso ao Minha RUAH. Por lá você poderá acompanhar seus perfumes, sua custódia, pedidos e envios de forma simples e privada.</p><p style="margin:30px 0"><a href="${escapeHtml(input.actionLink)}" style="display:inline-block;background:#1d1b18;color:#fff;text-decoration:none;padding:15px 24px;border-radius:4px;font-weight:bold">Criar meu acesso</a></p><p style="font-size:12px;line-height:1.6;color:#81786c">Este convite é pessoal e destinado somente a você. Se você não esperava recebê-lo, ignore esta mensagem.</p><p style="margin:28px 0 0;font-family:Georgia,serif">RUAH Parfums</p></td></tr></table></td></tr></table></body></html>`
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [input.to], subject: 'Seu acesso ao Minha RUAH está pronto', html }) })
    if (!response.ok) return { status: 'failed', error: `email_${response.status}` }
    return { status: 'sent' }
  } catch { return { status: 'failed', error: 'email_transport_error' } }
}

export async function sendInviteWhatsapp(input: { phone: string; name: string; actionLink: string }): Promise<DeliveryResult> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN'), phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId) return { status: 'not_configured' }
  const to = cleanPhone(input.phone)
  if (!to) return { status: 'unavailable', error: 'invalid_phone' }
  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: Deno.env.get('WHATSAPP_INVITE_TEMPLATE') ?? 'minha_ruah_convite_acesso', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: input.name }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: input.actionLink }] }] } }) })
    if (!response.ok) return { status: 'failed', error: `whatsapp_${response.status}` }
    return { status: 'sent' }
  } catch { return { status: 'failed', error: 'whatsapp_transport_error' } }
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) }
