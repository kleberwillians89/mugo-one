import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigins = new Set([
  'https://crmruahparfums.vercel.app',
  'https://crm.ruahparfums.com.br',
  'http://localhost:5173',
])

export const corsHeaders = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(allowedOrigins.has(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

export const json = (body: unknown, status = 200, req?: Request) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...(req ? corsHeaders(req) : {}) },
})

export async function context(req: Request) {
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) return { response: json({ error: { code: 'origin_forbidden', message: 'Origem não autorizada.' } }, 403, req) }
  if (req.method === 'OPTIONS') return { response: new Response(null, { status: 204, headers: corsHeaders(req) }) }
  if (req.method !== 'POST') return { response: json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, 405, req) }
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return { response: json({ error: { code: 'unauthorized', message: 'Autenticação necessária.' } }, 401, req) }
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return { response: json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req) }
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return { response: json({ error: { code: 'unauthorized', message: 'Sessão inválida.' } }, 401, req) }
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return { response: json({ error: { code: 'invalid_json', message: 'Payload inválido.' } }, 400, req) } }
  const organizationId = String(body.organization_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { response: json({ error: { code: 'invalid_org', message: 'Organização inválida.' } }, 400, req) }
  const { data: membership } = await client.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return { response: json({ error: { code: 'forbidden', message: 'Acesso negado.' } }, 403, req) }
  return { client, user, body, organizationId, role: membership.role }
}

export async function audit(client: ReturnType<typeof createClient>, organizationId: string, actorId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await client.from('audit_logs').insert({ organization_id: organizationId, actor_id: actorId, action, entity_type: entityType, entity_id: entityId, metadata })
}
