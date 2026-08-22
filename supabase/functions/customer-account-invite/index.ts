import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, context, json } from '../_shared/security.ts'
import { sendInviteEmail, sendInviteWhatsapp } from '../_shared/customer-invite.ts'
import {firstAccessRedirectUrl} from '../_shared/public-app-url.ts'
const maskedEmail=(value:string)=>{const[local,domain]=value.split('@');return local&&domain?`${local[0]}***@${domain}`:'e-mail inválido'}

// "ENVIAR ACESSO / ATIVAR CONTA" no Cliente 360 (staff). Mesmo mecanismo
// nativo de convite do customer-claim-start — só que aqui é o funcionário,
// já autenticado, quem inicia (não precisa de CPF, o cliente já está
// selecionado na tela).
Deno.serve(async (req) => {
  const ctx = await context(req); if ('response' in ctx) return ctx.response
  const clientId = String(ctx.body.client_id ?? '')
  const email = String(ctx.body.email ?? '').trim().toLowerCase()
  const channels = { email: ctx.body.channels_email !== false, whatsapp: ctx.body.channels_whatsapp === true }
  if (!clientId || !email.includes('@')) return json({ error: { code: 'invalid_input', message: 'Informe o cliente e um e-mail válido.' } }, 400, req)

  // client_account_prepare_invite já reavalia has_org_role(admin,manager)
  // com o client do PRÓPRIO caller — nunca confia em "sou admin" do
  // frontend.
  const { data: account, error: prepareError } = await ctx.client.rpc('client_account_prepare_invite', { p_client_id: clientId, p_email: email })
  if (prepareError) {
    const alreadyActive = prepareError.message?.includes('account_already_active')
    return json({ error: { code: alreadyActive ? 'account_already_active' : 'forbidden', message: alreadyActive ? 'Esta cliente já ativou o Minha RUAH.' : 'Você não tem permissão para ativar contas de clientes.' } }, alreadyActive ? 409 : 403, req)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req)
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: client } = await admin.from('clients').select('name,phone,whatsapp_phone').eq('id', clientId).single()
  console.log({event:'auth_link_generation_start',source:'customer-account-invite',email:maskedEmail(email)})
  const linkType=account.auth_user_id?'recovery':'invite'
  const options=linkType==='invite'?{ redirectTo: firstAccessRedirectUrl(), data: { ruah_client_account_id: account.id, full_name: client?.name ?? 'Cliente RUAH', phone: client?.whatsapp_phone ?? client?.phone ?? '' } }:{redirectTo:firstAccessRedirectUrl()}
  const { data: generated, error: inviteError } = await admin.auth.admin.generateLink({ type: linkType, email, options })
  if (inviteError || !generated.properties?.action_link || !generated.user) { const alreadyExists=/already.*(?:registered|exists)|user.*exists/i.test(`${inviteError?.code??''} ${inviteError?.message??''}`);console.error({event:'auth_link_generation_failed',source:'customer-account-invite',email:maskedEmail(email),code:alreadyExists?'account_already_exists':'invite_link_failed'});return json({ error: { code: alreadyExists?'account_already_exists':'invite_failed', message: alreadyExists?'Já existe uma conta para este e-mail. Oriente a cliente a entrar ou recuperar a senha.':'Não foi possível gerar um convite seguro.' } }, alreadyExists?409:502, req) }
  console.log({event:'auth_link_generation_success',source:'customer-account-invite',email:maskedEmail(email)})
  if (!account.auth_user_id) await admin.rpc('client_account_link_auth_user', { p_account_id: account.id, p_auth_user_id: generated.user.id })
  const [emailResult, whatsappResult] = await Promise.all([
    channels.email ? sendInviteEmail({ to: email, name: client?.name ?? 'Cliente RUAH', actionLink: generated.properties.action_link, source: 'customer-account-invite' }) : Promise.resolve({ status: 'unavailable' as const }),
    channels.whatsapp ? sendInviteWhatsapp({ phone: client?.whatsapp_phone ?? client?.phone ?? '', name: client?.name ?? 'Cliente RUAH', actionLink: generated.properties.action_link }) : Promise.resolve({ status: 'unavailable' as const }),
  ])
  const errors = { ...(emailResult.error ? { email: emailResult.error } : {}), ...(whatsappResult.error ? { whatsapp: whatsappResult.error } : {}) }
  await admin.from('client_accounts').update({ invite_attempted_at: new Date().toISOString(), sent_email_at: emailResult.status === 'sent' ? new Date().toISOString() : account.sent_email_at, sent_whatsapp_at: whatsappResult.status === 'sent' ? new Date().toISOString() : account.sent_whatsapp_at, invite_last_error: Object.keys(errors).length ? errors : null }).eq('id', account.id)

  await audit(ctx.client, ctx.organizationId, ctx.user.id, 'customer_account_invited', 'client_account', account.id, { client_id: clientId })
  return json({ data: { status: 'invited', channels: { email: emailResult, whatsapp: whatsappResult } } }, 200, req)
})
