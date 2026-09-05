import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { emilySourceInspection, parseEmilyClients, reconcileEmilyClients, buildSafeManifest } from './emily-client-reconciliation.mjs'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const organizationId = '032fd96e-638f-428b-8cc2-37afc71e10ea'
const [, , sourceFile, snapshotFile, mode = 'dry-run', batchIdArg] = process.argv
if (!sourceFile || !snapshotFile || !['dry-run', 'apply', 'rollback'].includes(mode)) {
  console.error('Uso: node scripts/apply-emily-client-reconciliation.mjs <arquivo.csv> <snapshot.json> [dry-run|apply|rollback] [batch_id para rollback]')
  process.exit(1)
}

const inspection = emilySourceInspection(sourceFile)
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
const report = reconcileEmilyClients(parseEmilyClients(sourceFile), snapshot.tables.clients ?? [])
const manifest = buildSafeManifest(report, { source_file_sha256: inspection.sha256 })

const summary = {
  source_file: sourceFile, snapshot_file: snapshotFile, mode,
  source_sha256: inspection.sha256, encoding: inspection.encoding,
  counts: report.counts, safe_to_update: manifest.entries.length,
  manifest_sha256: manifest.sha256, fingerprint: manifest.fingerprint,
  client_id_reassignments: report.client_id_reassignments, sales_changed: report.sales_changed,
}

if (mode === 'dry-run') {
  console.log(JSON.stringify({ ...summary, database_writes: 0 }, null, 2))
  process.exit(0)
}
if (manifest.entries.length === 0 && mode === 'apply') throw new Error('Nenhuma alteração segura para aplicar.')
if (Date.now() - new Date(snapshot.created_at ?? snapshot.baseline?.created_at ?? Date.now()).getTime() > 15 * 60 * 1000) {
  console.error('Aviso: snapshot com mais de 15 minutos — considere gerar um snapshot mais recente antes de aplicar.')
}

const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8' }))
const key = keys.find(item => item.name === 'service_role' || item.type === 'service_role')?.api_key
if (!key) throw new Error('Credencial administrativa indisponível.')
const base = `https://${projectRef}.supabase.co/rest/v1`
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }
const request = async (endpoint, options = {}) => {
  const response = await fetch(`${base}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } })
  const bodyText = await response.text()
  const body = bodyText ? JSON.parse(bodyText) : null
  if (!response.ok) throw new Error(body?.message ?? `HTTP ${response.status}`)
  return body
}

const [admin] = await request(`/organization_members?organization_id=eq.${organizationId}&role=eq.admin&select=user_id&limit=1`)
if (!admin) throw new Error('Administrador da organização não encontrado.')

if (mode === 'apply') {
  const result = await request('/rpc/apply_client_cadastral_safe_batch', {
    method: 'POST',
    body: JSON.stringify({
      p_organization_id: organizationId, p_actor_id: admin.user_id,
      p_source_file_name: sourceFile.split('/').pop(), p_source_file_sha256: inspection.sha256,
      p_fingerprint: manifest.fingerprint, p_rows: manifest.entries,
    }),
  })
  console.log(JSON.stringify({ ...summary, database_writes: result.applied ?? 0, result }, null, 2))
} else if (mode === 'rollback') {
  if (!batchIdArg) throw new Error('Informe o batch_id para rollback.')
  const result = await request('/rpc/rollback_client_cadastral_safe_batch', {
    method: 'POST',
    body: JSON.stringify({ p_organization_id: organizationId, p_actor_id: admin.user_id, p_batch_id: batchIdArg }),
  })
  console.log(JSON.stringify({ mode, batch_id: batchIdArg, result }, null, 2))
}
