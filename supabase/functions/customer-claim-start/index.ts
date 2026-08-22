import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/security.ts'
import { firstAccessRedirectUrl, isAllowedPublicOrigin } from '../_shared/public-app-url.ts'
import {sendInviteEmail} from '../_shared/customer-invite.ts'

// Primeiro acesso da cliente ("Minha RUAH"). SEM Authorization: a cliente
// ainda não tem sessão nenhuma — não pode reusar context() (exige Bearer
// de um funcionário). Endpoint público, mas nunca revela se o CPF existe:
// a resposta é SEMPRE a mesma frase genérica, tenha ou não batido com um
// cadastro. O e-mail de verificação em si é o link de convite NATIVO do
// Supabase Auth (admin.inviteUserByEmail) — nenhuma infraestrutura de
// e-mail própria, nenhum código/hash inventado: quem prova posse do
// e-mail é o próprio Supabase, clicando o link.
const onlyDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '')

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedPublicOrigin(origin))
    return json({ error: { code: 'origin_forbidden', message: 'Origem não autorizada.' } }, 403, req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, 405, req)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: { code: 'invalid_json', message: 'Payload inválido.' } }, 400, req) }

  const cpf = onlyDigits(body.cpf)
  const email = String(body.email ?? '').trim().toLowerCase()
  // Resposta genérica: nunca distinguir "CPF não existe" de "CPF existe
  // mas e-mail não bate" de "já ativado". Sempre a MESMA frase.
  const generic = { data: { message: 'Se os dados enviados corresponderem a um cadastro existente, você receberá um e-mail com o próximo passo.' } }
  if (cpf.length !== 11 || !email.includes('@')) return json(generic, 200, req)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req)
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: client } = await admin.from('clients').select('id,organization_id,name')
    .eq('normalized_cpf', cpf).ilike('email', email).is('deleted_at', null).limit(1).maybeSingle()
  if (!client) return json(generic, 200, req)

  const { data: account } = await admin.rpc('client_account_prepare_invite', { p_client_id: client.id, p_email: email })
  if (!account) return json(generic, 200, req)

  // Idempotência: já ativa, ou e-mail disparado há menos de 2 minutos —
  // não reenvia (evita ruído/abuso), mas a resposta continua a mesma.
  const recentlyInvited = account.sent_email_at && Date.parse(account.sent_email_at) > Date.now() - 120_000
  if (account.status === 'active' || recentlyInvited) return json(generic, 200, req)

  const linkType=account.auth_user_id?'recovery':'invite'
  const options=linkType==='invite'?{redirectTo:firstAccessRedirectUrl(),data:{ruah_client_account_id:account.id}}:{redirectTo:firstAccessRedirectUrl()}
  const {data:generated,error:inviteError}=await admin.auth.admin.generateLink({type:linkType,email,options})
  if(inviteError||!generated.user||!generated.properties?.action_link)return json(generic,200,req)
  if(!account.auth_user_id)await admin.rpc('client_account_link_auth_user',{p_account_id:account.id,p_auth_user_id:generated.user.id})
  const delivery=await sendInviteEmail({to:email,name:client.name??'Cliente RUAH',actionLink:generated.properties.action_link,source:'customer-account-invite'})
  await admin.from('client_accounts').update({invite_attempted_at:new Date().toISOString(),sent_email_at:delivery.status==='sent'?new Date().toISOString():account.sent_email_at,invite_last_error:delivery.status==='sent'?null:{email:delivery.error??'email_delivery_failed'}}).eq('id',account.id)
  return json(generic, 200, req)
})
