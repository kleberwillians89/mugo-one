import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, context, json } from '../_shared/security.ts'

const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '')) ? String(value) : ''

Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId } = ctx

  const { data: allowed, error: permError } = await client.rpc('has_org_permission', {
    org_id: organizationId, permission_code: 'team.manage',
  })
  if (permError || !allowed) return json({ error: { code: 'forbidden', message: 'Você não tem permissão para redefinir senhas.' } }, 403, req)

  const targetUserId = uuid(body.target_user_id)
  if (!targetUserId) return json({ error: { code: 'invalid_target', message: 'Usuário inválido.' } }, 400, req)

  const password = String(body.password ?? '')
  if (password.length < 10) return json({ error: { code: 'invalid_password', message: 'A senha precisa ter pelo menos 10 caracteres.' } }, 400, req)

  // Confirma que o alvo realmente pertence à organização do caller — nunca
  // aceitar um user_id de outro tenant só porque veio no payload.
  const { data: member } = await client.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', targetUserId).maybeSingle()
  if (!member) return json({ error: { code: 'member_not_found', message: 'Usuário não encontrado nesta organização.' } }, 404, req)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req)
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { password })
  if (updateError) return json({ error: { code: 'reset_failed', message: 'Não foi possível redefinir a senha.' } }, 500, req)

  // Nunca a senha nova, nunca a antiga — só o fato de que houve reset.
  await audit(client, organizationId, user.id, 'user_password_reset', 'organization_member', targetUserId, {})

  return json({ ok: true }, 200, req)
})
