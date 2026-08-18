// RADAR GLOBAL - classificação de relevância determinística (sem IA) dos resultados de
// busca externa contra o que foi pedido (marca, nome do perfume, tamanho). Funções puras,
// testadas diretamente pelo vitest, nos moldes de *-domain.ts.
//
// Estados: exact | likely | weak | excluded. Nunca "adivinha" — títulos ambíguos ou
// incompletos ficam em weak/likely, nunca são promovidos a exact sem confirmação explícita.

export type Relevance = 'exact' | 'likely' | 'weak' | 'excluded'

export type CanonicalQuery = { brand: string; perfumeName: string; sizeMl: number | null }

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWord(normalizedText: string, word: string): boolean {
  if (!word) return false
  return new RegExp(`(^|\\s)${escapeRegExp(word)}(\\s|$)`).test(normalizedText)
}

function tokenize(normalizedValue: string): string[] {
  return normalizedValue.split(' ').filter(Boolean)
}

// Itens de acessório/formato que nunca são a oportunidade principal de compra do perfume
// cheio, mesmo quando marca e nome batem perfeitamente. Checado ANTES de qualquer outra regra.
const EXCLUSION_PHRASES = [
  'sample', 'samples', 'decant', 'decants', 'tester',
  'body lotion', 'lotion', 'shower gel', 'hair perfume',
  'gift set', 'inspired', 'dupe', 'impression', 'similar to',
]

export function matchesExclusionPhrase(title: string): boolean {
  const normalized = normalizeText(title)
  return EXCLUSION_PHRASES.some((phrase) => normalized.includes(phrase))
}

const ML_PATTERN = /(\d+(?:\.\d+)?)\s*ml\b/g
const OZ_PATTERN = /(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|oz)\b/g
const OZ_TO_ML = 29.5735

function isCloseTo(a: number, b: number, toleranceRatio = 0.05): boolean {
  return Math.abs(a - b) <= b * toleranceRatio
}

// Extrai todos os tamanhos distintos mencionados no título, já convertendo oz para ml
// (ex.: "3.4 oz" ~= 100ml) quando a equivalência for clara. Nunca inventa tamanho quando o
// título não menciona nenhum.
export function extractSizeMentionsMl(title: string): number[] {
  const normalized = normalizeText(title)
  const ml = [...normalized.matchAll(ML_PATTERN)].map((match) => Number(match[1]))
  const oz = [...normalized.matchAll(OZ_PATTERN)].map((match) => Number(match[1]) * OZ_TO_ML)
  const all = [...ml, ...oz]
  const distinct: number[] = []
  for (const value of all) {
    if (!distinct.some((existing) => isCloseTo(existing, value))) distinct.push(value)
  }
  return distinct
}

export type SizeMatchState = 'not_requested' | 'match' | 'ambiguous' | 'mismatch' | 'absent'

// 'match': todo tamanho mencionado bate com o pedido (inclui equivalências oz/ml do mesmo valor).
// 'ambiguous': o tamanho pedido está mencionado, mas outro tamanho diferente também está —
//   nunca promovido a exact automaticamente (ex.: "100ml / 2ml").
// 'mismatch': algum tamanho mencionado, mas nenhum bate com o pedido (ex.: só "2ml" quando 100ml foi pedido).
// 'absent': tamanho pedido, mas o título não menciona nenhum tamanho.
export function classifySizeMatch(title: string, requestedMl: number | null): SizeMatchState {
  if (!requestedMl) return 'not_requested'
  const mentioned = extractSizeMentionsMl(title)
  if (mentioned.length === 0) return 'absent'
  const matches = mentioned.filter((value) => isCloseTo(value, requestedMl))
  if (matches.length === 0) return 'mismatch'
  if (matches.length === mentioned.length) return 'match'
  return 'ambiguous'
}

// Classificação principal. Nunca reordena/adivinha: exige marca E todos os termos do nome
// (não necessariamente adjacentes) para considerar o nome "cheio". "Guidance" sem "46" é
// nome parcial — nunca é tratado como o mesmo produto que "Guidance 46".
export function classifyRelevance(title: string, canonical: CanonicalQuery): Relevance {
  if (matchesExclusionPhrase(title)) return 'excluded'

  const sizeState = classifySizeMatch(title, canonical.sizeMl)
  if (sizeState === 'mismatch') return 'excluded'

  const normalizedTitle = normalizeText(title)
  const brandToken = normalizeText(canonical.brand)
  const hasBrand = !brandToken || containsWord(normalizedTitle, brandToken)

  const nameTokens = tokenize(normalizeText(canonical.perfumeName))
  const matchedNameTokens = nameTokens.filter((token) => containsWord(normalizedTitle, token))
  const nameFull = nameTokens.length > 0 && matchedNameTokens.length === nameTokens.length
  const namePartial = matchedNameTokens.length > 0 && !nameFull

  if (hasBrand && nameFull) {
    if (sizeState === 'match' || sizeState === 'not_requested') return 'exact'
    if (sizeState === 'absent') return 'likely'
    return 'weak' // ambiguous: tamanho pedido presente, mas outro tamanho também é mencionado
  }
  if (hasBrand && namePartial) return 'weak'
  return 'weak'
}

// Marketplaces não são removidos, mas nunca herdam a confiança de marca oficial/revendedor
// autorizado/revendedor confiável — reconhecidos por uma lista fechada, nunca inferidos.
const KNOWN_MARKETPLACES = ['ebay', 'amazon', 'etsy', 'walmart', 'aliexpress', 'alibaba', 'wish', 'rakuten', 'mercado livre', 'temu', 'shopee']

function safeHostname(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export function classifySourceType(sellerName: string | null, url: string | null): 'marketplace' | null {
  const seller = normalizeText(sellerName)
  if (KNOWN_MARKETPLACES.some((marketplace) => seller.includes(marketplace))) return 'marketplace'
  const host = safeHostname(url)
  if (host && KNOWN_MARKETPLACES.some((marketplace) => host.includes(marketplace.replace(/\s+/g, '')))) return 'marketplace'
  return null
}

// Sinaliza preço fora da faixa observada (mediana) entre ofertas comparáveis — nunca exclui
// por preço, nunca acusa falsificação, só sinaliza para revisão humana. Só compara dentro do
// mesmo grupo de moeda confirmada, e só entre itens exact/likely (weak/excluded não entram
// na mediana, pois podem nem ser o produto certo).
export function flagPriceOutliers<T extends { price_native: number | null; currency: string | null; relevance: Relevance }>(
  offers: T[], thresholdRatio = 0.5,
): boolean[] {
  const comparable = offers
    .map((offer, index) => ({ offer, index }))
    .filter(({ offer }) => (offer.relevance === 'exact' || offer.relevance === 'likely') && offer.price_native != null && offer.currency)

  const byCurrency = new Map<string, number[]>()
  for (const { offer } of comparable) {
    const list = byCurrency.get(offer.currency as string) ?? []
    list.push(offer.price_native as number)
    byCurrency.set(offer.currency as string, list)
  }
  const medianByCurrency = new Map<string, number>()
  for (const [currency, prices] of byCurrency) {
    const sorted = [...prices].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    medianByCurrency.set(currency, median)
  }

  const flags = offers.map(() => false)
  for (const { offer, index } of comparable) {
    const median = medianByCurrency.get(offer.currency as string)
    if (median == null || median <= 0) continue
    const price = offer.price_native as number
    flags[index] = Math.abs(price - median) > median * thresholdRatio
  }
  return flags
}
