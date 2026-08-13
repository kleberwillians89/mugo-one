import readXlsxFile from 'read-excel-file/browser'
import Papa from 'papaparse'

export type PaymentStatus = 'paid' | 'pending' | 'cancelled' | 'unknown'

export type ParsedSale = {
  row: number
  client: string
  normalizedClient: string
  date: string | null
  amount: number | null
  paymentStatus: PaymentStatus
  paymentMethod: string
  note: string
  signature: string
  raw: Record<string, unknown>
  warnings: string[]
  blockers: string[]
  isImportable: boolean
  isAccountable: boolean
  isDuplicate: boolean
}

export type ImportPreview = {
  fileName: string
  sheets: string[]
  selectedSheet: string
  totalRows: number
  rows: ParsedSale[]
  valid: number
  rejected: number
  duplicates: number
  uniqueClients: number
  revenue: number
  importedValue: number
  reviewValue: number
  cancelledValue: number
  qualityPercent: number
}

export const normalizeClient = (value: unknown) =>
  String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export const isOperationalClientLabel = (value: unknown) =>
  ['disponivel para venda'].includes(normalizeClient(value))

export function parseBrazilianMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!String(value ?? '').trim()) return null
  let raw = String(value).trim().replace(/R\$\s?/gi, '').replace(/\s/g, '')
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.')
  else if (raw.includes(',')) raw = raw.replace(',', '.')
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

export function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10)
  const raw = String(value ?? '').trim()
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  const iso = raw.match(/^\d{4}-\d{2}-\d{2}/)
  return iso ? iso[0] : null
}

export function normalizeStatus(value: unknown): PaymentStatus {
  const status = normalizeClient(value)
  if (['pago', 'paga', 'quitado'].includes(status)) return 'paid'
  if (status.includes('cancel') || status.includes('estorn')) return 'cancelled'
  if (status.includes('aguard') || status.includes('pendente') || status.includes('nao pago')) return 'pending'
  return 'unknown'
}

const signature = (parts: unknown[]) => parts.map((x) => String(x ?? '')).join('|')

export const incrementalSaleSignature = (sale:{client:unknown;date:unknown;perfume:unknown;type:unknown;ml:unknown;amount:unknown;paymentStatus?:unknown;paymentMethod?:unknown}) =>
  signature([normalizeClient(sale.client),sale.date,normalizeClient(sale.perfume),normalizeClient(sale.type),
    normalizeClient(sale.ml),sale.amount])

export type IncrementalClassification='existing_exact'|'existing_changed'|'new_safe'|'possible_duplicate'|'review_required'
export type ComparableSale={client:unknown;date:unknown;perfume:unknown;type:unknown;ml:unknown;amount:unknown;paymentStatus?:unknown;paymentMethod?:unknown;paidAt?:unknown;shippedAt?:unknown;note?:unknown}
export function classifyIncrementalSale(incoming:ComparableSale,candidates:ComparableSale[]):IncrementalClassification {
  if(!normalizeClient(incoming.client)||!incoming.date||!normalizeClient(incoming.perfume)||!normalizeClient(incoming.type)||incoming.ml===null||incoming.amount===null)return'review_required'
  const identity=incrementalSaleSignature(incoming),exact=candidates.filter((candidate)=>incrementalSaleSignature(candidate)===identity)
  if(exact.length>1)return'possible_duplicate'
  if(exact.length===1){
    const mutable=(sale:ComparableSale)=>signature([normalizeStatus(sale.paymentStatus),normalizeClient(sale.paymentMethod),sale.paidAt??'',sale.shippedAt??'',normalizeClient(sale.note)])
    return mutable(exact[0])===mutable(incoming)?'existing_exact':'existing_changed'
  }
  const near=candidates.filter((candidate)=>normalizeClient(candidate.client)===normalizeClient(incoming.client)&&candidate.date===incoming.date&&normalizeClient(candidate.type)===normalizeClient(incoming.type))
  return near.length?'possible_duplicate':'new_safe'
}

export function analyzeIncrementalRows(rows:ParsedSale[],existingSignatures:Iterable<string>) {
  const existing=new Set(existingSignatures),seenInFile=new Set<string>()
  const classified=rows.map((row)=>{
    const raw=row.raw
    const key=incrementalSaleSignature({client:row.client,date:row.date,perfume:raw.PERFUME,type:raw.TIPO,ml:raw.ML,
      amount:row.amount,paymentStatus:raw.PAGAMENTO,paymentMethod:row.paymentMethod})
    const result=existing.has(key)?'existing':seenInFile.has(key)?'possible_duplicate':'new'
    seenInFile.add(key)
    return {row:row.row,signature:key,result}
  })
  return {
    rows:classified,newRows:classified.filter((row)=>row.result==='new').length,
    existingRows:classified.filter((row)=>row.result==='existing').length,
    possibleDuplicates:classified.filter((row)=>row.result==='possible_duplicate').length,
    comparisonComplete:existing.size>0,
  }
}

export function parseRows(fileName: string, sheets: string[], sheetName: string, matrix: unknown[][]): ImportPreview {
  const headers = (matrix[0] ?? []).map((x) => String(x ?? '').trim())
  const data = matrix.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
  )
  const seen = new Set<string>()
  let duplicates = 0
  const rows = data.map((source, index): ParsedSale => {
    const client = String(source.CLIENTE ?? '').replace(/\s+/g, ' ').trim()
    const normalizedClient = normalizeClient(client)
    const date = parseDate(source.DATA)
    const amount = parseBrazilianMoney(source.VALOR)
    const paymentStatus = normalizeStatus(source.PAGAMENTO)
    const paymentMethod = String(source['FORMA DE PAGAMENTO'] ?? '').trim()
    const sig = incrementalSaleSignature({client,date,perfume:source.PERFUME,type:source.TIPO,ml:source.ML,
      amount,paymentStatus:source.PAGAMENTO,paymentMethod:source['FORMA DE PAGAMENTO']})
    const warnings: string[] = []
    const blockers: string[] = []
    if (!client) blockers.push('Cliente ausente')
    if (isOperationalClientLabel(client)) blockers.push('Rótulo operacional, não é cliente')
    if (amount === null || amount < 0) blockers.push('Valor inválido ou ausente')
    if (!date) warnings.push('Data inválida ou ausente')
    if (paymentStatus === 'unknown') warnings.push('Status em revisão')
    if (!paymentMethod) warnings.push('Forma de pagamento em revisão')
    const isDuplicate = seen.has(sig)
    if (isDuplicate) { warnings.push('Possível duplicidade'); duplicates += 1 }
    seen.add(sig)
    const isImportable = blockers.length === 0
    const isAccountable = amount !== null && amount >= 0 && Boolean(date) && ['paid','pending'].includes(paymentStatus)
    return {
      row: index + 2, client, normalizedClient, date, amount, paymentStatus, paymentMethod,
      note: String(source['OBSERVAÇÃO'] ?? '').trim(), signature: sig, raw: source,
      warnings, blockers, isImportable, isAccountable, isDuplicate,
    }
  }).filter((row) => row.client || row.date || row.amount !== null)
    .filter((row) => normalizeClient(row.client) !== 'total:')
  const accepted = rows.filter((r) => r.isImportable)
  const accountable = rows.filter((r) => r.isAccountable)
  const financialRows = rows.filter((r) => r.amount !== null && r.amount >= 0)
  const review = financialRows.filter((r) => r.paymentStatus === 'unknown')
  return {
    fileName, sheets, selectedSheet: sheetName, totalRows: rows.length,
    rows, valid: accepted.length, rejected: rows.length - accepted.length, duplicates,
    uniqueClients: new Set(accepted.map((r) => r.normalizedClient)).size,
    revenue: accountable.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    importedValue: financialRows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    reviewValue: review.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    cancelledValue: financialRows.filter((r) => r.paymentStatus === 'cancelled').reduce((sum, r) => sum + (r.amount ?? 0), 0),
    qualityPercent: rows.length ? accountable.length / rows.length * 100 : 0,
  }
}

export async function readWorkbook(file: File, sheetName?: string) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const result = Papa.parse<unknown[]>(await file.text(), { skipEmptyLines: true })
    return { preview: parseRows(file.name, ['CSV'], 'CSV', result.data) }
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Formato não suportado com segurança')
  const readAllSheets = readXlsxFile as unknown as (source: File, options: { getSheets: true }) => Promise<{ sheet: string; data: unknown[][] }[]>
  const sheetMeta = await readAllSheets(file, { getSheets: true })
  const sheets = sheetMeta.map((sheet) => sheet.sheet)
  const selected = sheetName && sheets.includes(sheetName) ? sheetName : sheets.includes('PERFUMES') ? 'PERFUMES' : sheets[0]
  const matrix = sheetMeta.find((sheet) => sheet.sheet === selected)?.data ?? []
  return { preview: parseRows(file.name, sheets, selected, matrix) }
}
