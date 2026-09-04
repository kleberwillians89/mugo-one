import fs from 'node:fs'
import path from 'node:path'
import {analyzeDaviImport} from './davi-import-diagnostics-lib.mjs'

const [stagingPath, snapshotPath] = process.argv.slice(2)
if (!stagingPath || !snapshotPath) throw new Error('Uso: npm run analyze:davi-diagnostics -- staging.json snapshot.json')
const staging = JSON.parse(fs.readFileSync(stagingPath, 'utf8'))
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
const report = analyzeDaviImport({staging, snapshot})
const suffix = new Date().toISOString().replace(/[:.]/g, '-')
const output = path.join('private_data', `davi-import-diagnostic-${suffix}.json`)
fs.mkdirSync(path.dirname(output), {recursive: true})
fs.writeFileSync(output, JSON.stringify({...report, source_file: staging.report?.source ?? null, source_staging: path.basename(stagingPath), source_snapshot: path.basename(snapshotPath)}, null, 2))
console.log(JSON.stringify({output, zero_write: report.zero_write, total_lines: report.total_lines, vendas: report.identity, estoque: report.stock, inventory_by_perfume: report.inventory_by_perfume}, null, 2))
