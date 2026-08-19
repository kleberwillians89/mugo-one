import { fetchPerfumeMarginSummary } from './cost-margin'
import { presetPeriod } from './period'
import { RadarOffer, fetchOffersForPerfume } from './radar'
import { NEEDS_ATTENTION, ReplenishmentSignal, ReplenishmentStatus, fetchReplenishmentSignals } from './replenishment'

export type BuyingSignal = 'forte_oportunidade' | 'investigar' | 'baixa_prioridade' | 'dados_insuficientes'

export type BuyingContext = {
  perfumeId: string; perfumeName: string; brandHouse: string | null; baseName: string | null; bottleIdentifier: string | null
  availableMl: number | null; ml30d: number | null; velocityMlPerDay: number | null; coverageDays: number | null
  replenishmentStatus: ReplenishmentStatus | null
  costPerMl: number | null; marginPct: number | null; hasCost: boolean
  offerCount: number; bestOffer: RadarOffer | null
  signal: BuyingSignal
}

/** Comparável só quando a própria oferta já carrega um preço em BRL persistido (radar_offers.price_brl) ou já está em BRL — nunca calcula câmbio aqui (briefing: "Do not silently fabricate FX conversion"). */
export function isComparableOffer(offer: RadarOffer): boolean {
  return offer.currency === 'BRL' || offer.price_brl != null
}

/** Entre as ofertas ativas: comparável primeiro, depois confiável, depois maior score — nunca ordena por menor preço isolado (moedas diferentes não são comparáveis entre si sem price_brl). */
export function pickBestOffer(offers: RadarOffer[]): RadarOffer | null {
  const active = offers.filter((offer) => offer.active)
  if (active.length === 0) return null
  const ranked = [...active].sort((a, b) => {
    const comparableA = isComparableOffer(a) ? 0 : 1
    const comparableB = isComparableOffer(b) ? 0 : 1
    if (comparableA !== comparableB) return comparableA - comparableB
    const trustedA = a.source_trusted ? 0 : 1
    const trustedB = b.source_trusted ? 0 : 1
    if (trustedA !== trustedB) return trustedA - trustedB
    return b.score - a.score
  })
  return ranked[0]
}

/**
 * Determinístico — nunca uma decisão de IA (briefing: "AI must NOT decide
 * what to buy... margin calculation... offer score"). UNKNOWN margin/preço
 * nunca vira zero: a ausência do dado é o próprio motivo de cair em
 * "investigar" ou "dados insuficientes", nunca em "baixa prioridade" (essa
 * é reservada para quem genuinamente não precisa de compra agora).
 */
export function classifyBuyingSignal(ctx: {
  replenishmentStatus: ReplenishmentStatus | null; hasCost: boolean; marginPct: number | null; bestOffer: RadarOffer | null
}): BuyingSignal {
  if (!ctx.replenishmentStatus || ctx.replenishmentStatus === 'sem_dados') return 'dados_insuficientes'
  if (!(NEEDS_ATTENTION as ReplenishmentStatus[]).includes(ctx.replenishmentStatus)) return 'baixa_prioridade'
  const healthyMargin = ctx.hasCost && ctx.marginPct !== null && ctx.marginPct >= 20
  const comparableTrustedOffer = ctx.bestOffer !== null && ctx.bestOffer.source_trusted && isComparableOffer(ctx.bestOffer)
  return healthyMargin && comparableTrustedOffer ? 'forte_oportunidade' : 'investigar'
}

export const BUYING_SIGNAL_LABEL: Record<BuyingSignal, string> = {
  forte_oportunidade: 'FORTE OPORTUNIDADE', investigar: 'INVESTIGAR',
  baixa_prioridade: 'BAIXA PRIORIDADE', dados_insuficientes: 'DADOS INSUFICIENTES',
}

function findSignal(signals: ReplenishmentSignal[], perfumeId: string) {
  return signals.find((signal) => signal.perfume_id === perfumeId) ?? null
}

/**
 * Combina três fontes JÁ EXISTENTES (replenishment_signals, perfume_margin_summary,
 * radar_offers_for_perfume) — nenhuma migração nova, nenhuma duplicação de
 * lógica de negócio já implementada em cada uma delas. Só leitura de dados
 * persistidos: nunca chama busca externa (briefing: "must NOT automatically
 * call Serper or any paid/external provider" ao simplesmente abrir a tela).
 */
export async function fetchBuyingContext(perfumeId: string): Promise<BuyingContext | null> {
  const [signals, margin, offers] = await Promise.all([
    fetchReplenishmentSignals(),
    fetchPerfumeMarginSummary(presetPeriod('all')),
    fetchOffersForPerfume({ perfumeId }),
  ])
  const signal = findSignal(signals, perfumeId)
  const marginRow = margin.find((row) => row.perfume_id === perfumeId) ?? null
  if (!signal && !marginRow && offers.length === 0) return null

  const hasCost = marginRow?.has_cost ?? false
  const marginPct = marginRow?.margin_pct ?? null
  const bestOffer = pickBestOffer(offers)
  const replenishmentStatus = signal?.status ?? null

  return {
    perfumeId, perfumeName: signal?.perfume ?? marginRow?.perfume_name ?? 'Perfume',
    brandHouse: signal?.brand_house ?? null, baseName: signal?.base_name ?? null, bottleIdentifier: signal?.bottle_identifier ?? null,
    availableMl: signal?.available_ml ?? null, ml30d: signal?.ml_30d ?? null,
    velocityMlPerDay: signal?.velocity_ml_per_day ?? null, coverageDays: signal?.coverage_days ?? null,
    replenishmentStatus,
    costPerMl: marginRow?.average_cost_per_ml ?? null, marginPct, hasCost,
    offerCount: offers.filter((offer) => offer.active).length, bestOffer,
    signal: classifyBuyingSignal({ replenishmentStatus, hasCost, marginPct, bestOffer }),
  }
}
