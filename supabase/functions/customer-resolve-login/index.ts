import { corsHeaders, json } from '../_shared/security.ts'
import {isAllowedPublicOrigin} from '../_shared/public-app-url.ts'

// Endpoint legado mantido temporariamente para clientes antigos. A tela atual
// autentica diretamente por e-mail. Ele nunca mais resolve CPF -> e-mail:
// devolver o endereço real permitia enumeração de dados pessoais.
const PLACEHOLDER_EMAIL = 'conta-nao-encontrada@invalid.ruahparfums.com.br'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedPublicOrigin(origin))
    return json({ error: { code: 'origin_forbidden', message: 'Origem não autorizada.' } }, 403, req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, 405, req)

  try { await req.json() } catch { /* resposta deliberadamente indistinguível */ }
  return json({ data: { email: PLACEHOLDER_EMAIL } }, 200, req)
})
