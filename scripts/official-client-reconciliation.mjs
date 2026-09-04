import fs from 'node:fs'
import Papa from 'papaparse'

const text = (value) => String(value ?? '').replace(/\u0000/g, '').trim()
const digits = (value) => text(value).replace(/\D/g, '') || null
const fold = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
const validCpf = (value) => {
  const cpf = digits(value)
  if (!cpf || cpf.length !== 11 || /^([0-9])\1{10}$/.test(cpf)) return null
  const check = (length) => {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]) ? cpf : null
}
const validPhone = (value) => {
  const phone = digits(value)
  return phone && phone.length >= 8 && phone.length <= 15 && !/^([0-9])\1+$/.test(phone) ? phone : null
}
const validPostalCode = (value) => {
  const postalCode = digits(value)
  return postalCode && postalCode.length === 8 && !/^([0-9])\1{7}$/.test(postalCode) ? postalCode : null
}
const unique = (rows) => rows.length === 1 ? rows[0] : null
const indexBy = (rows, key) => {
  const index = new Map()
  for (const row of rows) {
    const value = row[key]
    if (value) index.set(value, [...(index.get(value) ?? []), row])
  }
  return index
}
const officialFields = (row) => ({
  name: text(row.muni ?? row.CLIENTE),
  cpf: text(row.CPF),
  phone: text(row.TELEFONE),
  postal_code: text(row.CEP),
  address_line: text(row['ENDEREÇO'] ?? row.ENDERECO),
  address_number: text(row['NÚMERO'] ?? row.NUMERO),
  complement: text(row['COMPL.']),
  district: text(row.BAIRRO),
  city: text(row['CIDADE'] ?? row['CIDADE ']),
  state: text(row.ESTADO),
})
const crmFields = (row) => ({
  name: text(row.name), cpf: validCpf(row.cpf), phone: validPhone(row.phone ?? row.whatsapp_phone),
  postal_code: validPostalCode(row.postal_code), address_line: text(row.address_line), address_number: text(row.address_number),
  complement: text(row.complement), district: text(row.district), city: text(row.city), state: text(row.state),
})
const proposedChanges = (official, crm) => {
  const changes = {}
  const conflicts = []
  const fields = ['cpf', 'phone', 'postal_code', 'address_line', 'address_number', 'complement', 'district', 'city', 'state']
  for (const field of fields) {
    const source = field === 'cpf' ? validCpf(official[field]) : field === 'phone' ? validPhone(official[field]) : field === 'postal_code' ? validPostalCode(official[field]) : text(official[field]) || null
    const current = crm[field] || null
    if (!source) continue
    if (!current) changes[field] = { before: null, after: source }
    else if (current !== source) conflicts.push({ field, current, official: source })
  }
  return { changes, conflicts }
}

export function parseOfficialClients(filePath) {
  const csv = fs.readFileSync(filePath).toString('latin1')
  const parsed = Papa.parse(csv, { header: true, delimiter: ';', skipEmptyLines: true })
  return parsed.data.map((row, index) => ({ source_row: index + 2, ...officialFields(row) })).filter(row => row.name)
}

export function officialClientSourceStats(filePath) {
  const csv = fs.readFileSync(filePath).toString('latin1')
  const parsed = Papa.parse(csv, { header: true, delimiter: ';', skipEmptyLines: true })
  const rows = parsed.data
  const nonEmpty = (key) => rows.filter(row => text(row[key])).length
  return { total_rows: rows.length, named_rows: nonEmpty('CLIENTE'), cpf_filled: nonEmpty('CPF'), phone_filled: nonEmpty('TELEFONE'), postal_code_filled: nonEmpty('CEP') }
}

export function reconcileOfficialClients(officialRows, crmRows) {
  const activeCrm = crmRows.filter(row => row.deleted_at == null && row.merged_into_id == null)
  const official = officialRows.map(row => ({ ...row, normalized_name: fold(row.name), normalized_cpf: validCpf(row.cpf), normalized_phone: validPhone(row.phone), normalized_postal_code: validPostalCode(row.postal_code) }))
  const crm = activeCrm.map(row => { const fields = crmFields(row); return { ...row, ...fields, normalized_name: fold(row.name), normalized_cpf: fields.cpf, normalized_phone: fields.phone, normalized_postal_code: fields.postal_code } })
  const officialCpf = indexBy(official, 'normalized_cpf')
  const officialPhone = indexBy(official, 'normalized_phone')
  const crmCpf = indexBy(crm, 'normalized_cpf')
  const crmPhone = indexBy(crm, 'normalized_phone')
  const officialName = indexBy(official, 'normalized_name')
  const crmName = indexBy(crm, 'normalized_name')
  const rows = official.map(source => {
    const invalid = (source.cpf && !source.normalized_cpf) || (source.phone && !source.normalized_phone) || (source.postal_code && !source.normalized_postal_code)
    const cpfCandidates = source.normalized_cpf ? crmCpf.get(source.normalized_cpf) ?? [] : []
    const phoneCandidates = source.normalized_phone ? crmPhone.get(source.normalized_phone) ?? [] : []
    const nameCandidates = crmName.get(source.normalized_name) ?? []
    const officialCpfDuplicate = source.normalized_cpf && (officialCpf.get(source.normalized_cpf) ?? []).length > 1
    const officialPhoneDuplicate = source.normalized_phone && (officialPhone.get(source.normalized_phone) ?? []).length > 1
    const conflicts = []
    let match = null
    let match_method = null
    if (officialCpfDuplicate || officialPhoneDuplicate || cpfCandidates.length > 1 || phoneCandidates.length > 1 || nameCandidates.length > 1) {
      return { source_row: source.source_row, official_name: source.name, crm_client_id: null, match_method: null, confidence: 0, classification: 'AMBIGUOUS', current_crm: null, official_source: source, proposed_changes: {}, conflicts: [{ field: officialCpfDuplicate || cpfCandidates.length > 1 ? 'cpf' : 'phone', reason: 'multiple_candidates' }] }
    }
    if (cpfCandidates.length === 1) { match = cpfCandidates[0]; match_method = 'EXACT_CPF' }
    else if (phoneCandidates.length === 1) { match = phoneCandidates[0]; match_method = 'EXACT_PHONE' }
    else if (nameCandidates.length === 1 && (officialName.get(source.normalized_name) ?? []).length === 1) { match = nameCandidates[0]; match_method = 'EXACT_UNIQUE_NAME' }
    if (!match) return { source_row: source.source_row, official_name: source.name, crm_client_id: null, match_method: null, confidence: 0, classification: invalid ? 'INVALID_SOURCE_DATA' : 'NEW_CLIENT', current_crm: null, official_source: source, proposed_changes: {}, conflicts: invalid ? [{ field: 'source', reason: 'invalid_source_data' }] : [] }
    const current = crmFields(match)
    if (match_method === 'EXACT_CPF' && source.normalized_phone && phoneCandidates.length === 1 && phoneCandidates[0].id !== match.id) conflicts.push({ field: 'phone', reason: 'phone_points_to_other_client', current: phoneCandidates[0].id })
    const changes = proposedChanges(source, current)
    conflicts.push(...changes.conflicts)
    const classification = invalid ? 'INVALID_SOURCE_DATA' : conflicts.some(item => item.field === 'cpf') ? 'CONFLICT' : match_method
    return { source_row: source.source_row, official_name: source.name, crm_client_id: match.id, match_method, confidence: match_method === 'EXACT_CPF' ? 1 : match_method === 'EXACT_PHONE' ? 0.98 : 0.95, classification, current_crm: current, official_source: source, proposed_changes: changes.changes, conflicts }
  })
  const counts = Object.fromEntries(['EXACT_CPF', 'EXACT_PHONE', 'EXACT_UNIQUE_NAME', 'NEW_CLIENT', 'AMBIGUOUS', 'CONFLICT', 'INVALID_SOURCE_DATA', 'UNMATCHED'].map(key => [key, rows.filter(row => row.classification === key).length]))
  return { total_official: official.length, counts, rows, proposed_update_count: rows.filter(row => row.crm_client_id && Object.keys(row.proposed_changes).length > 0 && !['CONFLICT', 'INVALID_SOURCE_DATA', 'AMBIGUOUS'].includes(row.classification)).length, client_id_reassignments: 0, sales_changed: 0 }
}

if (process.argv[1]?.endsWith('official-client-reconciliation.mjs')) {
  const file = process.argv[2] ?? '_reference/ruah-import/LISTA CLIENTES RUAH OFICIAL(DADOS CLIENTES).csv'
  const snapshotFile = process.argv[3] ?? 'private_data/supabase-snapshot-2026-09-04T19-20-38-262Z.json'
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
  const report = reconcileOfficialClients(parseOfficialClients(file), snapshot.tables.clients ?? [])
  console.log(JSON.stringify({ source_file: file, snapshot_file: snapshotFile, source_stats: officialClientSourceStats(file), ...report, rows: undefined }, null, 2))
}
