import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/security.ts'

// Login "CPF ou e-mail + senha": se a cliente digitar e-mail, o frontend
// chama signInWithPassword direto (Supabase Auth já resolve). Se digitar
// CPF, precisamos resolver CPF → e-mail no servidor (RLS nunca deixaria o
// navegador ler isso). Nunca revela se o CPF existe: quando não resolve,
// devolve um e-mail placeholder que garantidamente não existe em
// auth.users — o signInWithPassword subsequente falha com o MESMO erro
// genérico "Invalid login credentials" que uma senha errada daria, então
// as duas situações são indistinguíveis para quem está tentando.
const onlyDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
const PLACEHOLDER_EMAIL = 'conta-nao-encontrada@invalid.ruahparfums.com.br'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (origin && !new Set(['https://crmruahparfums.vercel.app', 'https://crm.ruahparfums.com.br', 'http://localhost:5173']).has(origin))
    return json({ error: { code: 'origin_forbidden', message: 'Origem não autorizada.' } }, 403, req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, 405, req)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: { code: 'invalid_json', message: 'Payload inválido.' } }, 400, req) }
  const cpf = onlyDigits(body.cpf)
  if (cpf.length !== 11) return json({ data: { email: PLACEHOLDER_EMAIL } }, 200, req)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500, req)
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: client } = await admin.from('clients').select('id').eq('normalized_cpf', cpf).is('deleted_at', null).limit(1).maybeSingle()
  if (!client) return json({ data: { email: PLACEHOLDER_EMAIL } }, 200, req)

  const { data: account } = await admin.from('client_accounts').select('auth_user_id,status').eq('client_id', client.id).eq('status', 'active').maybeSingle()
  if (!account?.auth_user_id) return json({ data: { email: PLACEHOLDER_EMAIL } }, 200, req)

  const { data: userResult } = await admin.auth.admin.getUserById(account.auth_user_id)
  const email = userResult?.user?.email
  return json({ data: { email: email ?? PLACEHOLDER_EMAIL } }, 200, req)
})
