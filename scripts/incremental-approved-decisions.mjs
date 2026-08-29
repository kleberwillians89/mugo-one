export const APPROVED_CLIENT_ALIASES = Object.freeze({
  'ana paula giombeli': {
    targetId: '816796c1-d619-47b9-8d82-5d5effd34a91',
    decision: 'ANA_PAULA_GIOMBELI_ALIAS',
  },
})

export const APPROVED_PERFUME_ALIASES = Object.freeze({
  'musc rogue - ormonde jayne': {
    targetId: '2c3cce47-15c4-4868-833a-ce51ec28726b',
    decision: 'MUSC_ROGUE_TO_MUSC_ROUGE',
  },
})

export const MILK_PLUS_NAME = 'milk + - commodity'

export const normalizeDecisionText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s*&\s*/g, ' & ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

export const approvedClientAlias = (value) => APPROVED_CLIENT_ALIASES[normalizeDecisionText(value)] ?? null
export const approvedPerfumeAlias = (value) => APPROVED_PERFUME_ALIASES[normalizeDecisionText(value)] ?? null
export const isApprovedDistinctMilkPlus = (value) => normalizeDecisionText(value) === MILK_PLUS_NAME
export const commercialPerfumeBase = (value) => normalizeDecisionText(value).replace(/\s*\(frasco\s*\d+\)\s*$/i, '').trim()
export const hasExplicitSourceValue = (value) => value !== null && value !== undefined && !['', '-'].includes(String(value).trim())

/** Somente ausência literal de valor recebe a exceção histórica. Zero continua sendo zero real. */
export const isHistoricalZeroMatchingValue = (value) => value === null || value === undefined || ['', '-'].includes(String(value).trim())

/** Marcadores comerciais de cancelamento; o número entre parênteses não vira volume para escrita. */
export const isCancelledSourceMl = (value) => /^(x(?:\s*\(\s*\d+\s*\))?|\(\s*x\s*\)\s*\d+)$/i.test(String(value ?? '').trim())

const sameNumber = (left, right) => Number(left) === Number(right)

/** Decisões de venda nova aprovadas por identidade completa, nunca por fuzzy matching. */
export const approvedNewSaleDecision = (row) => {
  const client = normalizeDecisionText(row.source_client ?? row.client)
  const perfume = normalizeDecisionText(row.source_perfume ?? row.perfume)
  if (perfume === MILK_PLUS_NAME) return 'MILK_PLUS_DISTINCT_NEW'
  if (perfume === 'musc rogue - ormonde jayne') return 'MUSC_ROGUE_ALIAS_NEW'
  if (client === 'ana paula giombeli' && row.date === '2026-08-14' && perfume === 'gioiosa - profumum roma (frasco 5)' && sameNumber(row.ml, 3) && sameNumber(row.amount, 83.7)) return 'ANA_PAULA_GIOMBELI_NEW'
  if (client === 'luciana alves' && row.date === '2026-06-28' && perfume === 'lilyphea - diptyque (frasco 2)' && sameNumber(row.ml, 5) && sameNumber(row.amount, 158.5)) return 'LUCIANA_LILYPHEA_NEW'
  if (client === 'luciana alves' && row.date === '2026-07-02' && perfume === "sur tes levres e.q. - d'orsay" && sameNumber(row.ml, 5) && sameNumber(row.amount, 128.5)) return 'LUCIANA_SUR_TES_LEVRES_NEW'
  return null
}

export const inventoryBaseline = (tables) => {
  const inventoryItems = tables.inventory_items ?? []
  const perfumes = tables.perfumes ?? []
  const operationalCodes = new Set(perfumes
    .map((perfume) => String(perfume.operational_code ?? '').trim().toUpperCase())
    .filter((code) => /^RUAH-P\d{6}$/.test(code)))
  return {
    inventory_items: inventoryItems.length,
    inventory_movements: (tables.inventory_movements ?? []).length,
    inventory_purchase_entries: Array.isArray(tables.inventory_purchase_entries) ? tables.inventory_purchase_entries.length : null,
    physical_ml: Math.round(inventoryItems.reduce((sum, item) => sum + Number(item.physical_ml ?? 0), 0) * 1000) / 1000,
    'RUAH-P': operationalCodes.size,
  }
}
