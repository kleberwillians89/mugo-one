import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import Papa from 'papaparse'

const text = (value) => String(value ?? '').replace(/\u0000/g, '').trim()
const digits = (value) => text(value).replace(/\D/g, '') || null
const fold = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')

// Replica public.normalize_br_phone (supabase/migrations/202608130001_operational_foundation.sql):
// só dígitos; 10-11 dígitos (BR sem DDI) ganha prefixo 55; 12-13 dígitos já com 55 fica como está;
// qualquer outro comprimento (ex.: +351, +1) fica só com os dígitos, sem inventar DDI.
const normalizeBrPhone = (value) => {
  const only = digits(value)
  if (!only) return null
  if ([10, 11].includes(only.length)) return `55${only}`
  if ([12, 13].includes(only.length) && only.startsWith('55')) return only
  return only
}
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
const validPostalCode = (value) => {
  const postalCode = digits(value)
  return postalCode && postalCode.length === 8 && !/^([0-9])\1{7}$/.test(postalCode) ? postalCode : null
}
const validEmail = (value) => {
  const email = text(value).toLowerCase()
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
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

const decodeBuffer = (buffer) => {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    return { text: buffer.toString('latin1'), encoding: 'latin1' }
  }
}

const emilyFields = (row) => ({
  name: text(row.muni ?? row.NOME ?? row.CLIENTE),
  cpf: text(row.CPF),
  phone: text(row.TELEFONE ?? row.WHATSAPP),
  email: text(row.EMAIL ?? row['E-MAIL'] ?? row['E-mail']),
  postal_code: text(row.CEP),
  address_line: text(row['ENDEREÇO'] ?? row.ENDERECO),
  address_number: text(row['NÚMERO'] ?? row.NUMERO),
  complement: text(row['COMPL.'] ?? row.COMPLEMENTO),
  district: text(row.BAIRRO),
  city: text(row['CIDADE'] ?? row['CIDADE ']),
  state: text(row.ESTADO),
})
const crmFields = (row) => ({
  name: text(row.name),
  cpf: validCpf(row.cpf),
  phone: normalizeBrPhone(row.phone ?? row.whatsapp_phone),
  email: validEmail(row.email),
  postal_code: validPostalCode(row.postal_code),
  address_line: text(row.address_line), address_number: text(row.address_number),
  complement: text(row.complement), district: text(row.district), city: text(row.city), state: text(row.state),
})

export function parseEmilyClients(filePath) {
  const { text: csv } = decodeBuffer(fs.readFileSync(filePath))
  const parsed = Papa.parse(csv, { header: true, delimiter: ';', skipEmptyLines: true })
  return parsed.data.map((row, index) => ({ source_row: index + 2, ...emilyFields(row) })).filter(row => row.name)
}

export function emilySourceInspection(filePath) {
  const buffer = fs.readFileSync(filePath)
  const { text: csv, encoding } = decodeBuffer(buffer)
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const parsed = Papa.parse(csv, { header: true, delimiter: ';', skipEmptyLines: true })
  const rows = parsed.data
  const nonEmpty = (key) => rows.filter(row => text(row[key])).length
  const columns = parsed.meta.fields ?? []
  return {
    file_path: filePath, sha256, encoding, columns,
    total_rows: rows.length,
    named_rows: nonEmpty('muni') || nonEmpty('NOME') || nonEmpty('CLIENTE'),
    cpf_filled: nonEmpty('CPF'), phone_filled: nonEmpty('TELEFONE') || nonEmpty('WHATSAPP'),
    email_filled: nonEmpty('EMAIL') || nonEmpty('E-MAIL') || nonEmpty('E-mail'),
    postal_code_filled: nonEmpty('CEP'),
    address_filled: nonEmpty('ENDEREÇO') || nonEmpty('ENDERECO'),
  }
}

const addressComplete = (source) => Boolean(
  validPostalCode(source.postal_code) && source.address_line && source.address_number && source.district && source.city && source.state,
)

const proposedChanges = (source, current, matchMethod) => {
  const changes = {}
  const conflicts = []
  const contactFields = ['cpf', 'phone', 'email']
  const addressFields = ['postal_code', 'address_line', 'address_number', 'complement', 'district', 'city', 'state']
  const validators = { cpf: validCpf, phone: normalizeBrPhone, email: validEmail, postal_code: validPostalCode }
  for (const field of contactFields) {
    const source_value = validators[field] ? validators[field](source[field]) : (text(source[field]) || null)
    const current_value = current[field] || null
    if (!source_value) continue
    if (!current_value) { changes[field] = { before: null, after: source_value }; continue }
    if (current_value === source_value) continue
    if (field === 'cpf') { conflicts.push({ field, current: current_value, official: source_value }); continue }
    // telefone/e-mail diferentes só podem ser propostos quando a própria
    // identificação da linha veio de CPF exato — nunca em match por nome.
    if (matchMethod === 'EXACT_CPF') changes[field] = { before: current_value, after: source_value }
    else conflicts.push({ field, current: current_value, official: source_value, note: 'contact_diff_requires_cpf_match' })
  }
  const strongMatch = matchMethod === 'EXACT_CPF' || matchMethod === 'EXACT_EMAIL' || matchMethod === 'EXACT_PHONE'
  const addressDiffers = addressFields.some(field => {
    const source_value = text(source[field]) || null
    const current_value = current[field] || null
    return source_value && current_value && source_value !== current_value
  })
  for (const field of addressFields) {
    const source_value = field === 'postal_code' ? validPostalCode(source[field]) : (text(source[field]) || null)
    const current_value = current[field] || null
    if (!source_value) continue
    if (!current_value) { changes[field] = { before: null, after: source_value }; continue }
    if (current_value === source_value) continue
    // Endereço diferente só é sobrescrito com match forte (não só nome) e
    // planilha da Emily completa/válida para este cliente; nunca apaga por
    // causa de uma célula vazia (isso já é coberto pelo `if (!source_value)`).
    if (strongMatch && addressComplete(source)) changes[field] = { before: current_value, after: source_value }
    else conflicts.push({ field, current: current_value, official: source_value, note: 'address_diff_requires_strong_match_and_complete_source' })
  }
  return { changes, conflicts, addressDiffers }
}

export function reconcileEmilyClients(sourceRows, crmRows) {
  const activeCrm = crmRows.filter(row => row.deleted_at == null && row.merged_into_id == null)
  const source = sourceRows.map(row => ({
    ...row,
    normalized_name: fold(row.name), normalized_cpf: validCpf(row.cpf),
    normalized_phone: normalizeBrPhone(row.phone), normalized_email: validEmail(row.email),
    normalized_postal_code: validPostalCode(row.postal_code),
  }))
  const crm = activeCrm.map(row => {
    const fields = crmFields(row)
    return {
      ...row, ...fields, normalized_name: fold(row.name),
      normalized_cpf: fields.cpf, normalized_phone: fields.phone, normalized_email: fields.email,
      normalized_postal_code: fields.postal_code,
    }
  })
  const officialCpf = indexBy(source, 'normalized_cpf'), officialEmail = indexBy(source, 'normalized_email')
  const officialPhone = indexBy(source, 'normalized_phone'), officialName = indexBy(source, 'normalized_name')
  const crmCpf = indexBy(crm, 'normalized_cpf'), crmEmail = indexBy(crm, 'normalized_email')
  const crmPhone = indexBy(crm, 'normalized_phone'), crmName = indexBy(crm, 'normalized_name')

  const rows = source.map(item => {
    const invalid = (item.cpf && !item.normalized_cpf) || (item.phone && !item.normalized_phone)
      || (item.email && !item.normalized_email) || (item.postal_code && !item.normalized_postal_code)
    const cpfCandidates = item.normalized_cpf ? crmCpf.get(item.normalized_cpf) ?? [] : []
    const emailCandidates = item.normalized_email ? crmEmail.get(item.normalized_email) ?? [] : []
    const phoneCandidates = item.normalized_phone ? crmPhone.get(item.normalized_phone) ?? [] : []
    const nameCandidates = crmName.get(item.normalized_name) ?? []
    const officialCpfDup = item.normalized_cpf && (officialCpf.get(item.normalized_cpf) ?? []).length > 1
    const officialEmailDup = item.normalized_email && (officialEmail.get(item.normalized_email) ?? []).length > 1
    const officialPhoneDup = item.normalized_phone && (officialPhone.get(item.normalized_phone) ?? []).length > 1
    const base = { source_row: item.source_row, official_name: item.name, official_source: item }
    if (officialCpfDup || officialEmailDup || officialPhoneDup || cpfCandidates.length > 1 || emailCandidates.length > 1 || phoneCandidates.length > 1 || nameCandidates.length > 1) {
      const field = officialCpfDup || cpfCandidates.length > 1 ? 'cpf' : officialEmailDup || emailCandidates.length > 1 ? 'email' : officialPhoneDup || phoneCandidates.length > 1 ? 'phone' : 'name'
      return { ...base, crm_client_id: null, match_method: null, confidence: 0, classification: 'AMBIGUOUS', current_crm: null, proposed_changes: {}, conflicts: [{ field, reason: 'multiple_candidates' }] }
    }
    let match = null, match_method = null
    if (cpfCandidates.length === 1) { match = cpfCandidates[0]; match_method = 'EXACT_CPF' }
    else if (emailCandidates.length === 1) { match = emailCandidates[0]; match_method = 'EXACT_EMAIL' }
    else if (phoneCandidates.length === 1) { match = phoneCandidates[0]; match_method = 'EXACT_PHONE' }
    else if (nameCandidates.length === 1 && (officialName.get(item.normalized_name) ?? []).length === 1) { match = nameCandidates[0]; match_method = 'EXACT_UNIQUE_NAME' }
    if (!match) return { ...base, crm_client_id: null, match_method: null, confidence: 0, classification: invalid ? 'INVALID_SOURCE_DATA' : 'NEW_CLIENT', current_crm: null, proposed_changes: {}, conflicts: invalid ? [{ field: 'source', reason: 'invalid_source_data' }] : [] }
    const current = crmFields(match)
    const { changes, conflicts, addressDiffers } = proposedChanges(item, current, match_method)
    if (match_method !== 'EXACT_CPF' && item.normalized_cpf && cpfCandidates.length === 1 && cpfCandidates[0].id !== match.id) conflicts.push({ field: 'cpf', reason: 'cpf_points_to_other_client', current: cpfCandidates[0].id })
    const classification = invalid ? 'INVALID_SOURCE_DATA' : conflicts.some(entry => entry.field === 'cpf' && entry.reason !== 'multiple_candidates') ? 'CONFLICT' : match_method
    return {
      ...base, crm_client_id: match.id, match_method, confidence: match_method === 'EXACT_CPF' ? 1 : match_method === 'EXACT_EMAIL' ? 0.99 : match_method === 'EXACT_PHONE' ? 0.98 : 0.95,
      classification, current_crm: { ...current, updated_at: match.updated_at }, proposed_changes: changes, conflicts, address_differs_unresolved: addressDiffers && !Object.keys(changes).some(field => ['postal_code', 'address_line', 'address_number', 'complement', 'district', 'city', 'state'].includes(field)),
    }
  })
  const counts = Object.fromEntries(['EXACT_CPF', 'EXACT_EMAIL', 'EXACT_PHONE', 'EXACT_UNIQUE_NAME', 'NEW_CLIENT', 'AMBIGUOUS', 'CONFLICT', 'INVALID_SOURCE_DATA', 'UNMATCHED'].map(key => [key, rows.filter(row => row.classification === key).length]))
  const safeToUpdate = rows.filter(row => row.crm_client_id && ['EXACT_CPF', 'EXACT_EMAIL', 'EXACT_PHONE', 'EXACT_UNIQUE_NAME'].includes(row.classification) && Object.keys(row.proposed_changes).length > 0)
  return { total_source: source.length, counts, rows, safe_to_update: safeToUpdate, client_id_reassignments: 0, sales_changed: 0 }
}

// Ordem fixa dos campos cadastráveis — usada tanto aqui quanto na RPC SQL
// (public.client_cadastral_safe_batch_fingerprint) para computar exatamente
// o mesmo fingerprint dos dois lados, sem depender de JSON.stringify (cuja
// ordem de chaves não é um contrato estável entre JS e SQL).
export const CADASTRAL_FIELDS = ['cpf', 'phone', 'email', 'postal_code', 'address_line', 'address_number', 'complement', 'district', 'city', 'state']

export function buildSafeManifest(reconcileResult, meta) {
  const entries = reconcileResult.safe_to_update
    .map(row => ({
      client_id: row.crm_client_id,
      match_method: row.match_method,
      expected_updated_at: row.current_crm.updated_at ?? null,
      source_row: row.source_row,
      proposed_changes: row.proposed_changes,
      before: Object.fromEntries(Object.entries(row.proposed_changes).map(([field, change]) => [field, change.before])),
      after: Object.fromEntries(Object.entries(row.proposed_changes).map(([field, change]) => [field, change.after])),
    }))
    .sort((left, right) => String(left.client_id).localeCompare(String(right.client_id)))
  const canonical = JSON.stringify({ source_file_sha256: meta.source_file_sha256, entries })
  const sha256 = crypto.createHash('sha256').update(canonical).digest('hex')
  const unitSep = String.fromCharCode(31), recordSep = String.fromCharCode(30)
  const fingerprintSource = entries.map(entry => [
    entry.client_id, entry.match_method, entry.expected_updated_at ?? '', String(entry.source_row),
    ...CADASTRAL_FIELDS.map(field => entry.proposed_changes[field]?.after ?? ''),
  ].join(unitSep)).join(recordSep)
  const fingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex')
  return { entries, canonical, sha256, fingerprint }
}

if (path.basename(process.argv[1] ?? '') === 'emily-client-reconciliation.mjs') {
  const file = process.argv[2]
  const snapshotFile = process.argv[3]
  if (!file || !snapshotFile) { console.error('uso: node scripts/emily-client-reconciliation.mjs <arquivo.csv> <snapshot.json>'); process.exit(1) }
  const inspection = emilySourceInspection(file)
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
  const result = reconcileEmilyClients(parseEmilyClients(file), snapshot.tables.clients ?? [])
  const manifest = buildSafeManifest(result, { source_file_sha256: inspection.sha256 })
  console.log(JSON.stringify({
    source_file: file, snapshot_file: snapshotFile, inspection, counts: result.counts,
    safe_to_update_count: result.safe_to_update.length, manifest_sha256: manifest.sha256, fingerprint: manifest.fingerprint,
    client_id_reassignments: result.client_id_reassignments, sales_changed: result.sales_changed,
  }, null, 2))
}
