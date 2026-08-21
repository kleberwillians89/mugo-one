export type InviteChannels = { email: boolean; whatsapp: boolean }
export type InviteSource = 'customer-registration-start' | 'customer-account-invite'
export type DeliveryResult = { status: 'sent' | 'failed' | 'not_configured' | 'unavailable'; provider?: 'resend'; provider_message_id?: string; error?: string }

const cleanPhone = (value: string) => { const digits = value.replace(/\D/g, ''); return digits.length >= 10 ? (digits.startsWith('55') ? digits : `55${digits}`) : '' }
const firstName = (value: string) => value.trim().split(/\s+/)[0] || 'Cliente'
const maskedEmail = (value:string) => { const [local,domain]=value.trim().toLowerCase().split('@');return local&&domain?`${local[0]}***@${domain}`:'e-mail inválido' }
const safeProviderError = (raw: string) => {
  try { const parsed=JSON.parse(raw) as {message?:unknown;name?:unknown};const value=typeof parsed.message==='string'?parsed.message:typeof parsed.name==='string'?parsed.name:'';return value.replace(/[\r\n]/g,' ').slice(0,180)||'provider_rejected_request' }
  catch { return 'provider_rejected_request' }
}

export function renderCustomerInviteEmail(input:{name:string;actionLink:string}) {
  const name=escapeHtml(firstName(input.name)),actionLink=escapeHtml(input.actionLink)
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F5F2EC;color:#191713;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F5F2EC"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5DED2"><tr><td align="center" style="padding:42px 34px 24px;border-bottom:1px solid #E9E2D7"><div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;letter-spacing:5px;color:#191713">RUAH</div><div style="margin-top:8px;font-size:10px;line-height:16px;letter-spacing:3px;color:#A37D2C">PARFUMS · MINHA RUAH</div></td></tr><tr><td style="padding:42px 42px 38px"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:36px;color:#191713">Olá, ${name}.</p><p style="margin:0 0 16px;font-size:17px;line-height:27px;color:#25211C">Seu acesso ao Minha RUAH está pronto.</p><p style="margin:0 0 30px;font-size:14px;line-height:24px;color:#665F54">A partir de agora, você poderá acompanhar seus perfumes, histórico, envios e solicitar ajuda diretamente pela sua área exclusiva.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#191713" style="border-radius:5px"><a href="${actionLink}" style="display:inline-block;min-width:220px;padding:16px 24px;font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-align:center;text-decoration:none;color:#FFFFFF">CRIAR MINHA SENHA</a></td></tr></table><p style="margin:28px 0 0;font-size:12px;line-height:20px;color:#7B7367">Este link é pessoal e deve ser utilizado somente por você.</p><p style="margin:8px 0 0;font-size:12px;line-height:20px;color:#7B7367">Se você não solicitou este acesso, pode ignorar esta mensagem.</p></td></tr><tr><td style="padding:25px 42px;background:#FAF8F4;border-top:1px solid #E9E2D7"><div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;letter-spacing:2px;color:#191713">RUAH PARFUMS</div><div style="margin-top:6px;font-size:10px;letter-spacing:1px;color:#9A7627">ATENDIMENTO EXCLUSIVO</div></td></tr></table></td></tr></table></body></html>`
}

export function renderCustomerInviteText(input:{name:string;actionLink:string}) {
  return `RUAH PARFUMS · Minha RUAH\n\nOlá, ${firstName(input.name)}.\n\nSeu acesso ao Minha RUAH está pronto.\n\nA partir de agora, você poderá acompanhar seus perfumes, histórico, envios e solicitar ajuda diretamente pela sua área exclusiva.\n\nCRIAR MINHA SENHA:\n${input.actionLink}\n\nEste link é pessoal e deve ser utilizado somente por você.\n\nSe você não solicitou este acesso, pode ignorar esta mensagem.\n\nRUAH PARFUMS\nAtendimento exclusivo`
}

export async function sendInviteEmail(input:{to:string;name:string;actionLink:string;source:InviteSource}):Promise<DeliveryResult> {
  const token=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RUAH_INVITE_FROM')
  console.log({event:'customer_email_send_start',source:input.source,recipient:maskedEmail(input.to),has_resend_key:Boolean(token),has_from:Boolean(from),recipient_present:Boolean(input.to),action_link_present:Boolean(input.actionLink)})
  if(!token||!from)return{status:'not_configured',provider:'resend',error:!token?'missing_resend_key':'missing_invite_from'}
  if(!input.to.trim()||!input.to.includes('@'))return{status:'unavailable',provider:'resend',error:'invalid_recipient'}
  if(!input.actionLink.trim())return{status:'unavailable',provider:'resend',error:'missing_action_link'}
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({from,to:[input.to],subject:'Seu acesso ao Minha RUAH está pronto',html:renderCustomerInviteEmail(input),text:renderCustomerInviteText(input)})})
    const raw=await response.text()
    console.log({event:'customer_email_provider_response',source:input.source,provider:'resend',status:response.status,ok:response.ok})
    if(!response.ok){const providerError=safeProviderError(raw);console.error({event:'customer_email_send_failed',source:input.source,provider:'resend',status:response.status,provider_error:providerError});return{status:'failed',provider:'resend',error:`email_${response.status}`}}
    let result:{id?:unknown};try{result=JSON.parse(raw) as {id?:unknown}}catch{result={}}
    if(typeof result.id!=='string'||!result.id){console.error({event:'customer_email_send_failed',source:input.source,provider:'resend',status:response.status,provider_error:'missing_provider_message_id'});return{status:'failed',provider:'resend',error:'email_invalid_provider_response'}}
    console.log({event:'customer_email_sent',source:input.source,provider:'resend',provider_message_id:result.id})
    return{status:'sent',provider:'resend',provider_message_id:result.id}
  } catch {console.error({event:'customer_email_send_failed',source:input.source,provider:'resend',status:0,provider_error:'transport_error'});return{status:'failed',provider:'resend',error:'email_transport_error'}}
}

export async function sendInviteWhatsapp(input:{phone:string;name:string;actionLink:string}):Promise<DeliveryResult> {
  const token=Deno.env.get('WHATSAPP_ACCESS_TOKEN'),phoneNumberId=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');if(!token||!phoneNumberId)return{status:'not_configured'}
  const to=cleanPhone(input.phone);if(!to)return{status:'unavailable',error:'invalid_phone'}
  try{const response=await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:Deno.env.get('WHATSAPP_INVITE_TEMPLATE')??'minha_ruah_convite_acesso',language:{code:'pt_BR'},components:[{type:'body',parameters:[{type:'text',text:input.name}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:input.actionLink}]}]}})});if(!response.ok)return{status:'failed',error:`whatsapp_${response.status}`};return{status:'sent'}}catch{return{status:'failed',error:'whatsapp_transport_error'}}
}

function escapeHtml(value:string){return value.replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}
