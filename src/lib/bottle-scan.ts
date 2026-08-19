/**
 * Pure logic for the "Modo Ilde" bottle-identity workflow: parsing whatever
 * a camera/barcode-scanner/manual field hands us into a lookup the backend
 * can resolve, and the human-facing before/after math for a conference.
 * No Supabase calls here — see inventory-bottles.ts for those.
 */

export type ScanLookup =
  | { kind: 'token'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'split'; value: string }

/**
 * A QR decode yields a full deep-link URL; a physical barcode scanner types
 * "RUAH-F000185" + Enter; manual entry may be either the bare code
 * ("F000185") or the full barcode value. A split code ("S000185-001",
 * bare or "RUAH-"-prefixed) resolves as its own kind — a split is never a
 * bottle, so it is never a "kind: code" match — one canonical parser, used
 * by camera/HID/manual entry alike (briefing seção 9: "resolvedor
 * canônico", nunca lógica duplicada por componente).
 */
export function parseScannedValue(raw: string): ScanLookup | null {
  const value = raw.trim()
  if (!value) return null

  const urlMatch = value.match(/\/q\/([^/?#\s]+)/)
  if (urlMatch) return { kind: 'token', value: urlMatch[1] }

  // A bare token (no URL wrapper) still routes as a token lookup — same
  // shape a deep link resolves to once the /q/:token path segment is peeled off.
  if (/^[0-9a-f]{64}$/i.test(value)) return { kind: 'token', value }

  const splitMatch = value.match(/^(?:RUAH-)?(S\d{6}-\d{3})$/i)
  if (splitMatch) return { kind: 'split', value: splitMatch[1].toUpperCase() }

  const codeMatch = value.match(/^(?:RUAH-)?(F\d{6})$/i)
  if (codeMatch) return { kind: 'code', value: codeMatch[1].toUpperCase() }

  return null
}

export type ConferenceDiff = {
  before: number
  after: number
  delta: number
  changed: boolean
}

export function computeConferenceDiff(before: number, after: number): ConferenceDiff {
  const delta = round3(after - before)
  return { before: round3(before), after: round3(after), delta, changed: delta !== 0 }
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000
}

export function formatMl(value: number) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)} ml`
}

export function formatDelta(delta: number) {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(delta)} ml`
}

/** APC = disponibilidade da unidade aplicadora do frasco — nunca ml (seção 9/14). */
export function apcLabel(available: boolean) {
  return { headline: available ? '1 DE 1' : '0 DE 1', status: available ? 'APC DISPONÍVEL' : 'APC INDISPONÍVEL' }
}

export function bottleDisplayLabel(bottleLabel: string, bottleCode: string) {
  return `${bottleLabel} · ${bottleCode}`
}

/** Onboarding reconciliation preview (seção 8): never auto-corrects, only reports. */
export type TrackingReconciliation = {
  systemMl: number
  identifiedMl: number
  diff: number
  reconciled: boolean
}

export function computeTrackingReconciliation(systemMl: number, identifiedMl: number): TrackingReconciliation {
  const diff = round3(identifiedMl - systemMl)
  return { systemMl: round3(systemMl), identifiedMl: round3(identifiedMl), diff, reconciled: diff === 0 }
}
