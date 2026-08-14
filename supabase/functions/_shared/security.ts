import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {resolveTenant} from './tenant-resolution.ts'

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

export async function context(req: Request,options:{allowSingleOrganizationFallback?:boolean}={}) {
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
  const candidate=body.organization_id
  if(!options.allowSingleOrganizationFallback&&(!candidate||!/^[0-9a-f-]{36}$/i.test(String(candidate))))return{response:json({error:{code:'invalid_org',message:'Não foi possível identificar sua empresa. Atualize a página e tente novamente.'}},400,req)}
  const {data:memberships,error:membershipError}=await client.from('organization_members').select('organization_id,role').eq('user_id',user.id)
  if(membershipError)return{response:json({error:{code:'organization_lookup_failed',message:'Não foi possível identificar sua empresa. Atualize a página e tente novamente.'}},500,req)}
  const resolved=resolveTenant(candidate,memberships??[])
  if(!resolved.ok){
    const messages={invalid_org:'Não foi possível identificar sua empresa. Atualize a página e tente novamente.',no_organization:'Seu acesso não está vinculado a uma empresa.',organization_required:'Selecione a empresa ativa e tente novamente.',forbidden:'Você não tem acesso à empresa selecionada.'}
    return{response:json({error:{code:resolved.code,message:messages[resolved.code]}},resolved.status,req)}
  }
  return { client, user, body, organizationId:resolved.organizationId, role:resolved.role }
}

export async function audit(client: ReturnType<typeof createClient>, organizationId: string, actorId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await client.from('audit_logs').insert({ organization_id: organizationId, actor_id: actorId, action, entity_type: entityType, entity_id: entityId, metadata })
}
