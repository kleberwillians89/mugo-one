import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const base = `https://${projectRef}.supabase.co`
const raw = execFileSync('supabase', ['projects','api-keys','--project-ref',projectRef,'--output','json'], { encoding:'utf8' })
const keys = JSON.parse(raw)
const publicKey = keys.find((key) => ['anon','publishable'].includes(key.name) || ['anon','publishable'].includes(key.type))?.api_key
if (!publicKey) throw new Error('Chave pública do projeto não encontrada.')
const headers = { apikey:publicKey, authorization:`Bearer ${publicKey}`, 'content-type':'application/json' }
const results = []
const check = async (name, url, options, expected) => {
  const response = await fetch(url, options)
  results.push({ name, status:response.status, passed:expected.includes(response.status) })
}

// Neste projeto SELECT é liberado a nível de grant e a proteção real é a
// RLS policy (mesmo padrão já em produção para sale_payment_attachments e
// audit_logs: ambas também respondem 200+[] para anon). O teste que importa
// é o corpo vir SEMPRE vazio para anon — nunca 401/403 aqui seria sinal de
// regressão de grant, mas o gate de segurança de fato é o corpo vazio.
{
  const response = await fetch(`${base}/rest/v1/collection_events?select=id&limit=1`, { headers })
  const body = response.ok ? await response.json() : null
  results.push({ name:'collection_events: anon não enxerga nenhuma linha (RLS)', status:response.status, passed:response.status===200 && Array.isArray(body) && body.length===0 })
}

// anon/public NUNCA deve conseguir executar as 3 RPCs novas (revoke all from public,anon).
await check('RPC collections_pending_sales: anon bloqueado', `${base}/rest/v1/rpc/collections_pending_sales`, { method:'POST', headers, body:JSON.stringify({ p_search:null }) }, [401,403])
await check('RPC collections_log_message_copied: anon bloqueado', `${base}/rest/v1/rpc/collections_log_message_copied`, { method:'POST', headers, body:JSON.stringify({ p_client_id:'00000000-0000-0000-0000-000000000000' }) }, [401,403])
await check('RPC collections_register_payment: anon bloqueado', `${base}/rest/v1/rpc/collections_register_payment`, { method:'POST', headers, body:JSON.stringify({ p_sale_ids:[], p_paid_at:'2026-01-01', p_payment_method:'pix' }) }, [401,403])

// anon/public NUNCA deve conseguir escrever direto na tabela (insert/update/delete revogados).
await check('collection_events: anon INSERT bloqueado', `${base}/rest/v1/collection_events`, { method:'POST', headers, body:'{}' }, [401,403])

console.table(results)
if (results.some((result) => !result.passed)) process.exit(1)
console.log('OK: fronteira anon/public->authenticated confirmada em produção para o módulo Cobranças.')
