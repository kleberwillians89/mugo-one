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
for (const table of ['clients','perfumes','sales','shipments','inventory_allocations','client_accounts','audit_logs']) {
  const response = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, { headers })
  const body = response.ok ? await response.json() : null
  results.push({
    name:`RLS: ${table} anônimo sem vazamento`,
    status:response.status,
    passed:response.status===200 && Array.isArray(body) && body.length===0,
  })
}
{
  const response = await fetch(`${base}/rest/v1/clients`,{method:'POST',headers,body:JSON.stringify({
    organization_id:'032fd96e-638f-428b-8cc2-37afc71e10ea',
    name:'SECURITY CHECK — MUST NEVER BE INSERTED',
    normalized_name:'security check must never be inserted',
  })})
  let body = null
  try { body = await response.json() } catch { /* corpo não JSON */ }
  const rlsRejected = response.status === 400
    && body?.code === '42501'
    && /row-level security|permission denied/i.test(String(body?.message ?? ''))
  results.push({ name:'RLS: escrita anônima bloqueada', status:response.status, passed:[401,403].includes(response.status)||rlsRejected })
}
for (const bucket of ['commercial-imports','collection-images','sale-payment-attachments','customer-support-attachments']) {
  await check(`Bucket privado: ${bucket}`,`${base}/storage/v1/object/public/${bucket}/security-check.txt`,{},[400,404])
}
for (const fn of ['process-import','confirm-import','revert-import','generate-insights','ask-intelligence','recalculate-metrics']) {
  await check(`JWT obrigatório: ${fn}`,`${base}/functions/v1/${fn}`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'},[401])
}
console.table(results)
if (results.some((result)=>!result.passed)) process.exit(1)
