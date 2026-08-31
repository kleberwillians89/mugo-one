import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const outputDir = process.argv[2] || 'private_data'
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8' }))
const key = keys.find((item) => item.name === 'service_role' || item.type === 'service_role')?.api_key
if (!key) throw new Error('Credencial administrativa indisponível.')
const base = `https://${projectRef}.supabase.co/rest/v1`
const headers = { apikey: key, authorization: `Bearer ${key}` }
const all = async (table, select = '*') => {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${base}/${table}?select=${select}&offset=${offset}&limit=1000`, { headers })
    if (!response.ok) throw new Error(`Leitura falhou: HTTP ${response.status} (${table})`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}
const bottles = await all('inventory_bottles', 'id,physical_ml,status')
const batchItems = await all('preparation_batch_items', 'id,quantity_ml,source_bottle_id')
const batches = await all('preparation_batches', 'id,status')
const summary = {
  created_at: new Date().toISOString(),
  inventory_bottles: {
    count: bottles.length,
    physical_ml_total: Math.round(bottles.reduce((sum, b) => sum + Number(b.physical_ml ?? 0), 0) * 1000) / 1000,
    by_status: Object.fromEntries(['active', 'empty', 'retired'].map((s) => [s, bottles.filter((b) => b.status === s).length])),
  },
  preparation_batch_items: {
    count: batchItems.length,
    with_source_bottle: batchItems.filter((i) => i.source_bottle_id !== null).length,
  },
  preparation_batches_by_status: Object.fromEntries(['draft', 'awaiting_scan', 'identified', 'confirmed', 'cancelled'].map((s) => [s, batches.filter((b) => b.status === s).length])),
}
const name = `bottles-complement-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(path.join(outputDir, name), JSON.stringify(summary))
console.log(JSON.stringify({ file: path.join(outputDir, name), summary }, null, 2))
