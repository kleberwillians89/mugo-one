import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { context, json } from '../_shared/security.ts'

// Convenção de login por usuário (briefing "LOGIN POR USUÁRIO"): Dona Ilde
// nunca inventa um e-mail real para funcionário. "davi.vendas" vira, só
// internamente, davi.vendas@acesso.ruahparfums.com.br — a pessoa nunca
// precisa saber disso. Se o valor digitado já tem "@", é tratado como
// e-mail de verdade (compatibilidade com contas antigas).
const INTERNAL_DOMAIN = 'acesso.ruahparfums.com.br'
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

function normalizeUsername(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value.includes('@')) return USERNAME_RE.test(value.split('@')[0]) ? value : null
  return USERNAME_RE.test(value) ? value : null
}

const ALLOWED_PRESETS = ['administrador', 'gestor', 'comercial', 'entregas', 'estoque', 'visualizacao', 'personalizado']

Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId } = ctx

  // Autoridade real: nunca confiar em "sou admin" vindo do frontend —
  // reavalia com o client do PRÓPRIO caller (RLS/has_org_permission real).
  const { data: allowed, error: permError } = await client.rpc('has_org_permission', {
    org_id: organizationId, permission_code: 'team.manage',
  })
  if (permError || !allowed) return json({ error: { code: 'forbidden', message: 'Você não tem permissão para gerenciar usuários.' } }, 403, req)

  const username = normalizeUsername(body.username)
  if (!username) return json({ error: { code: 'invalid_username', message: 'Usuário inválido. Use letras minúsculas, números, ponto, underline ou hífen (3-32 caracteres).' } }, 400, req)

  const displayName = String(body.display_name ?? '').trim()
  if (!displayName) return json({ error: { code: 'invalid_name', message: 'Informe o nome.' } }, 400, req)

  const password = String(body.password ?? '')
  if (password.length < 10) return json({ error: { code: 'invalid_password', message: 'A senha precisa ter pelo menos 10 caracteres.' } }, 400, req)

  const preset = String(body.preset ?? '')
  if (!ALLOWED_PRESETS.includes(preset)) return json({ error: { code: 'invalid_preset', message: 'Perfil inválido.' } }, 400, req)

  const viewAll = Boolean(body.view_all)
  const accessTotal = Boolean(body.access_total)
  const overrides = Array.isArray(body.overrides) ? body.overrides : []

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req)
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const email = username.includes('@') ? username : `${username}@${INTERNAL_DOMAIN}`

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: displayName, ruah_username: username },
  })
  if (createError || !created.user) {
    const duplicate = /already registered|already exists/i.test(createError?.message ?? '')
    return json({ error: { code: duplicate ? 'username_taken' : 'create_failed', message: duplicate ? 'Este usuário já existe.' : 'Não foi possível criar o usuário.' } }, duplicate ? 409 : 400, req)
  }

  const { error: provisionError } = await admin.rpc('team_provision_member', {
    p_organization_id: organizationId,
    p_user_id: created.user.id,
    p_full_name: displayName,
    p_preset: preset,
    p_view_all: viewAll,
    p_access_total: accessTotal,
    p_actor_id: user.id,
  })
  if (provisionError) {
    // Compensação: sem isto o usuário fica órfão no Auth, sem organização —
    // nunca deixar essa sobra (briefing "Se falhar depois de criar auth
    // user: fazer compensação segura").
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: { code: 'provision_failed', message: 'Não foi possível vincular o usuário à organização.' } }, 500, req)
  }

  // Overrides pessoais opcionais no momento da criação (Personalizar
  // Permissões desde o início) — reaproveita team_set_permissions, que já
  // checa team.manage de novo (idempotente, sem custo real aqui) e a
  // proteção do último admin.
  if (overrides.length > 0) {
    const { error: overrideError } = await client.rpc('team_set_permissions', {
      p_organization_id: organizationId,
      p_target_user_id: created.user.id,
      p_preset: preset,
      p_view_all: viewAll,
      p_access_total: accessTotal,
      p_overrides: overrides,
    })
    if (overrideError) return json({ error: { code: 'overrides_failed', message: 'Usuário criado, mas não foi possível aplicar as permissões personalizadas.' } }, 500, req)
  }

  return json({ user_id: created.user.id, username }, 200, req)
})
