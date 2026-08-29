// Diagnóstico READ-ONLY do matching do analyzer incremental.
// Não escreve no banco. Lê o snapshot + a última staging + a planilha.
// Uso: node scripts/diagnose-incremental-matching.mjs "<arquivo.xlsx>" [snapshot.json] [staging.json]
import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'

const input = process.argv[2]
if (!input) throw new Error('Informe o caminho da planilha.')
const pick = (prefix) => fs.readdirSync('private_data').filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().at(-1)
const snapshotPath = process.argv[3] ?? path.join('private_data', pick('supabase-snapshot-'))
const stagingPath = process.argv[4] ?? path.join('private_data', pick('incremental-staging-'))

const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const stripFrasco = (v) => normalize(v).replace(/\s*\(\s*frasco\s*\d+\s*\)\s*$/i, '').trim()
const number = (v) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null
const date = (v) => v instanceof Date && !Number.isNaN(v.valueOf()) ? v.toISOString().slice(0, 10) : String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
const status = (v) => { const x = normalize(v); if (['pago', 'paga', 'quitado', 'paid'].includes(x)) return 'paid'; if (x.includes('cancel') || x.includes('estorn')) return 'cancelled'; if (x.includes('aguard') || x.includes('pendente') || x.includes('nao pago') || x === 'pending') return 'pending'; return 'unknown' }
const key = (vals) => vals.map((v) => String(v ?? '')).join('|')

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
const staging = JSON.parse(fs.readFileSync(stagingPath, 'utf8'))
const sales = (snapshot.tables.sales ?? []).filter((s) => s.deleted_at === null)
const clients = snapshot.tables.clients ?? []
const perfumes = snapshot.tables.perfumes ?? []
const clientById = new Map(clients.map((c) => [c.id, c]))
const perfumeById = new Map(perfumes.map((p) => [p.id, p]))

// ---- Identidade das vendas do banco: dois modos, com e sem frasco ----
const dbSale = (s) => {
  const rawName = perfumeById.get(s.perfume_id)?.full_name_raw ?? s.perfume_name_raw
  return {
    id: s.id,
    client: normalize(clientById.get(s.client_id)?.name ?? s.client_name_raw ?? s.original_client),
    date: date(s.sale_date),
    perfume_full: normalize(rawName),
    perfume_base: stripFrasco(rawName),
    type: normalize(s.sale_type),
    ml: number(s.volume_ml),
    amount: number(Number(s.amount)),
    payment_status: status(s.payment_status),
    payment_method: normalize(s.payment_method) || null,
    paid_at: date(s.paid_at),
    shipped_at: date(s.shipped_at),
    split_completed_at: date(s.split_completed_at),
    note: normalize(s.notes) || null,
  }
}
const db = sales.map(dbSale)

// ---- Planilha ----
const workbook = await readXlsxFile(input, { getSheets: true })
const sheet = workbook.find((w) => w.sheet === 'PERFUMES') ?? workbook[0]
const headers = (sheet.data[0] ?? []).map((v) => String(v ?? '').trim())
const hasSplitColumn = headers.some((h) => normalize(h) === 'data do split')
const sheetRows = sheet.data.slice(1)
  .map((vals, i) => ({ source_row: i + 2, raw: Object.fromEntries(headers.map((h, c) => [h, vals[c] ?? null])) }))
  .filter(({ raw }) => headers.some((h) => raw[h] !== null && String(raw[h]).trim()))

const isAdmin = (raw) => ['total:', 'disponivel para venda'].includes(normalize(raw.CLIENTE))
const rowModel = (r) => ({
  source_row: r.source_row,
  client: normalize(r.raw.CLIENTE),
  display_client: String(r.raw.CLIENTE ?? '').trim(),
  date: date(r.raw.DATA),
  perfume_full: normalize(r.raw.PERFUME),
  perfume_base: stripFrasco(r.raw.PERFUME),
  display_perfume: String(r.raw.PERFUME ?? '').trim(),
  type: normalize(r.raw.TIPO),
  ml: number(r.raw.ML),
  amount: number(r.raw.VALOR),
  payment_status: status(r.raw.PAGAMENTO),
  payment_method: normalize(r.raw['FORMA DE PAGAMENTO']) || null,
  paid_at: date(r.raw['DATA PAGMT']),
  shipped_at: date(r.raw['DATA DE ENVIO']),
  split_completed_at: hasSplitColumn ? date(r.raw['DATA DO SPLIT']) : null,
  raw: r.raw,
})
const models = sheetRows.filter((r) => !isAdmin(r.raw)).map(rowModel)
const adminRows = sheetRows.filter((r) => isAdmin(r.raw))

// ================================================================
// SEÇÃO 2 — NORMALIZAÇÃO DE PERFUME
// ================================================================
const existingPerfumeFull = new Set(perfumes.map((p) => normalize(p.full_name_raw)))
const existingPerfumeBase = new Set(perfumes.map((p) => stripFrasco(p.full_name_raw)))
const dbPerfumeBaseCount = new Map()
for (const s of db) dbPerfumeBaseCount.set(s.perfume_base, (dbPerfumeBaseCount.get(s.perfume_base) ?? 0) + 1)

const sheetPerfFull = new Map(), sheetPerfBase = new Map()
for (const m of models) {
  if (!m.perfume_full) continue
  sheetPerfFull.set(m.perfume_full, (sheetPerfFull.get(m.perfume_full) ?? 0) + 1)
  sheetPerfBase.set(m.perfume_base, (sheetPerfBase.get(m.perfume_base) ?? 0) + 1)
}
const baseMatch = [...sheetPerfBase.keys()].filter((b) => existingPerfumeBase.has(b))
const baseNew = [...sheetPerfBase.keys()].filter((b) => !existingPerfumeBase.has(b))
const frascoOnlyDifference = [...sheetPerfFull.keys()].filter((f) => !existingPerfumeFull.has(f) && existingPerfumeBase.has(stripFrasco(f)))

const perfumeReport = {
  source_identities_full: sheetPerfFull.size,
  source_identities_base_after_strip_frasco: sheetPerfBase.size,
  db_catalog_perfumes: perfumes.length,
  match_existing_by_full_name: [...sheetPerfFull.keys()].filter((f) => existingPerfumeFull.has(f)).length,
  match_existing_after_strip_frasco: baseMatch.length,
  true_new_after_strip_frasco: baseNew.length,
  identities_that_only_differ_by_frasco: frascoOnlyDifference.length,
  top50_alleged_new_full: [...sheetPerfFull.entries()]
    .filter(([f]) => !existingPerfumeFull.has(f))
    .sort((a, b) => b[1] - a[1]).slice(0, 50)
    .map(([f, n]) => ({ perfume: f, occurrences: n, base: stripFrasco(f), base_exists_in_catalog: existingPerfumeBase.has(stripFrasco(f)) })),
  top50_true_new_base: [...sheetPerfBase.entries()]
    .filter(([b]) => !existingPerfumeBase.has(b))
    .sort((a, b) => b[1] - a[1]).slice(0, 50)
    .map(([b, n]) => ({ perfume_base: b, occurrences: n })),
}

// ================================================================
// SEÇÃO 3 — REJECTED / REVIEW REQUIRED
// ================================================================
const invalidReason = (m) => {
  if (!m.client) return 'cliente ausente'
  if (!m.date) return 'data invalida'
  if (!m.perfume_full) return 'perfume ausente'
  if (!['apc', 'split'].includes(m.type)) return `tipo invalido (${JSON.stringify(m.raw.TIPO)})`
  if (m.ml === null) return `ml invalido (${JSON.stringify(m.raw.ML)})`
  if (m.amount === null) return `valor ausente/invalido (${JSON.stringify(m.raw.VALOR)})`
  return null
}
const rejectedDetail = models.map((m) => ({ ...m, invalid: invalidReason(m) })).filter((m) => m.invalid)
const rejectCats = {}
for (const r of rejectedDetail) {
  const bucket = r.invalid.startsWith('ml') ? 'ML inválido'
    : r.invalid.startsWith('valor') ? 'Valor ausente/inválido'
    : r.invalid.startsWith('tipo') ? 'Tipo inválido'
    : r.invalid.startsWith('data') ? 'Data inválida'
    : r.invalid.startsWith('cliente') ? 'Cliente ausente'
    : r.invalid.startsWith('perfume') ? 'Perfume ausente' : 'Outro'
  ;(rejectCats[bucket] = rejectCats[bucket] ?? []).push({ row: r.source_row, cliente: r.display_client, tipo: r.raw.TIPO, ml: r.raw.ML, perfume: r.display_perfume, valor: r.raw.VALOR, motivo: r.invalid })
}
const rejectedReport = {
  administrative_rows: {
    total: adminRows.length,
    'TOTAL': adminRows.filter((r) => normalize(r.raw.CLIENTE) === 'total:').length,
    'DISPONÍVEL PARA VENDA': adminRows.filter((r) => normalize(r.raw.CLIENTE) === 'disponivel para venda').length,
  },
  rejected_sales_total: rejectedDetail.length,
  categories: Object.fromEntries(Object.entries(rejectCats).map(([k, v]) => [k, v.length])),
  full_list: rejectCats,
}

// ================================================================
// SEÇÃO 1 + 4 — MULTISET / ORDINAL MATCHING (base identity)
// ================================================================
const MUTABLE = ['payment_status', 'payment_method', 'paid_at', 'shipped_at', 'note', ...(hasSplitColumn ? ['split_completed_at'] : [])]
const identity = (o) => key([o.client, o.date, o.perfume_base, o.type, o.ml, o.amount])
const valid = (m) => !invalidReason(m)

const dbGroups = new Map()
for (const s of db) { const k = identity(s); if (!dbGroups.has(k)) dbGroups.set(k, []); dbGroups.get(k).push(s) }
const sheetGroups = new Map()
for (const m of models.filter(valid)) { const k = identity(m); if (!sheetGroups.has(k)) sheetGroups.set(k, []); sheetGroups.get(k).push(m) }

const mutableDiff = (a, b) => MUTABLE.filter((f) => (a[f] ?? null) !== (b[f] ?? null))
const proj = { UNCHANGED: 0, CHANGED: 0, NEW: 0, AMBIGUOUS: 0, MISSING_FROM_NEW_SOURCE: 0 }
const changeCounts = { payment_status: 0, payment_method: 0, paid_at: 0, shipped_at: 0, note: 0, split_completed_at: 0, pending_to_paid: 0, unknown_to_paid: 0 }
const ambiguousCases = [], missingSample = []
const matchedDbIds = new Set()

for (const [k, sheetList] of sheetGroups) {
  const dbList = (dbGroups.get(k) ?? []).slice()
  // pareamento ordinal determinístico: ordena ambos por source_row / created_at
  sheetList.sort((a, b) => a.source_row - b.source_row)
  dbList.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const pairCount = Math.min(sheetList.length, dbList.length)
  for (let i = 0; i < pairCount; i++) {
    const sRow = sheetList[i], dRow = dbList[i]
    matchedDbIds.add(dRow.id)
    const diff = mutableDiff(dRow, sRow)
    if (diff.length === 0) { proj.UNCHANGED++; continue }
    proj.CHANGED++
    for (const f of diff) changeCounts[f]++
    if (dRow.payment_status === 'pending' && sRow.payment_status === 'paid') changeCounts.pending_to_paid++
    if (dRow.payment_status === 'unknown' && sRow.payment_status === 'paid') changeCounts.unknown_to_paid++
  }
  // sobra na planilha
  for (let i = pairCount; i < sheetList.length; i++) {
    const sRow = sheetList[i]
    // NEW só se não houver correspondência próxima que sugira alias/erro
    const nearMiss = db.some((s) => !matchedDbIds.has(s.id)
      && s.client === sRow.client && s.date === sRow.date && s.type === sRow.type
      && ((s.ml === sRow.ml && s.amount === sRow.amount && s.perfume_base !== sRow.perfume_base)
        || (s.perfume_base === sRow.perfume_base && (s.ml !== sRow.ml || s.amount !== sRow.amount))))
    if (nearMiss) { proj.AMBIGUOUS++; ambiguousCases.push({ source_row: sRow.source_row, cliente: sRow.display_client, data: sRow.date, perfume: sRow.display_perfume, ml: sRow.ml, valor: sRow.amount, motivo: 'Excedente com correspondência comercial próxima não pareada' }) }
    else proj.NEW++
  }
}
// db não pareado = MISSING
for (const s of db) {
  if (matchedDbIds.has(s.id)) continue
  proj.MISSING_FROM_NEW_SOURCE++
  if (missingSample.length < 40) missingSample.push({ sale_id: s.id, cliente: clientById.get(sales.find((x) => x.id === s.id).client_id)?.name, data: s.date, perfume: s.perfume_base, tipo: s.type, ml: s.ml, valor: s.amount })
}

// ================================================================
// SEÇÃO 1 — POR QUE OS 4291 possible_duplicate DA STAGING ANTIGA
// ================================================================
const oldPd = staging.rows.filter((r) => r.classification === 'possible_duplicate')
const oldPdCats = {}
for (const r of oldPd) {
  const base = stripFrasco(r.perfume)
  const dbBaseHit = dbGroups.get(key([r.client, r.date, base, r.type, r.ml, r.amount])) ?? []
  let bucket
  if (dbBaseHit.length >= 1 && /\(frasco/i.test(r.perfume || '')) bucket = 'Sufixo (FRASCO n) — identidade do perfume divergente do catálogo'
  else if (r.reason.includes('repetida')) bucket = 'Linhas idênticas dentro da planilha (falta multiset)'
  else if (r.reason.includes('lteseme') || r.reason.includes('lias')) bucket = 'Perfume semelhante (Levenshtein) — alias/frasco'
  else if (dbBaseHit.length > 1) bucket = 'Múltiplas vendas no banco com a mesma identidade (falta multiset)'
  else if (dbBaseHit.length === 0) bucket = 'Sem correspondência exata mesmo após normalizar frasco — divergência real de campo'
  else bucket = 'Outro'
  oldPdCats[bucket] = (oldPdCats[bucket] ?? 0) + 1
}

// ================================================================
// SAÍDA
// ================================================================
const out = {
  inputs: { snapshot: path.basename(snapshotPath), staging: path.basename(stagingPath), sheet: path.basename(input), has_split_column: hasSplitColumn },
  remote_baseline: snapshot.baseline,
  sheet_totals: { non_blank_rows: sheetRows.length, admin_rows: adminRows.length, sale_candidates: models.length, valid_sale_candidates: models.filter(valid).length, rejected: rejectedDetail.length },
  section1_old_possible_duplicate: { total: oldPd.length, by_root_cause: oldPdCats },
  section2_perfumes: perfumeReport,
  section3_rejected: rejectedReport,
  section4_algorithm: {
    identity_fields: ['client_canonical', 'sale_date', 'perfume_base (frasco stripped)', 'sale_type', 'volume_ml', 'amount'],
    mutable_fields_ignored_for_identity: MUTABLE,
    method: 'Agrupa banco e planilha pela identidade comercial estável. Dentro de cada grupo, pareia ordinalmente min(n_planilha, n_banco). Pares sem diff de campo mutável = UNCHANGED; com diff = CHANGED (mesmo sale.id). Excedente de planilha = NEW (ou AMBIGUOUS se houver near-miss não pareado). Excedente de banco = MISSING_FROM_NEW_SOURCE (nunca deletado).',
  },
  section5_missing_from_new_source: { total: proj.MISSING_FROM_NEW_SOURCE, sample: missingSample },
  projection_after_fix: { ...proj, change_breakdown: changeCounts },
  ambiguous_cases_sample: ambiguousCases.slice(0, 40),
}
fs.writeFileSync(path.join('private_data', 'diagnose-matching.json'), JSON.stringify({ ...out, section1_full_list: oldPd.map((r) => ({ source_row: r.source_row, cliente: r.display_client, cliente_norm: r.client, data: r.date, tipo: r.type, ml: r.ml, perfume: r.display_perfume, perfume_norm: r.perfume, perfume_base: stripFrasco(r.perfume), valor: r.amount, pagamento: r.payment_status, reason: r.reason })) }, null, 2))
console.log(JSON.stringify(out, null, 2))
