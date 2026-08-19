import { PerfumeMarginRow, fetchPerfumeMarginSummary, summarizeMargin } from './cost-margin'
import { presetPeriod } from './period'
import { fetchClientRecoveryQueue } from './client-recovery'
import { OperationalShipment, fetchOperationalShipments } from './records'
import { RadarOffer, fetchOffersForPerfume } from './radar'
import { classifyBuyingSignal, pickBestOffer } from './radar-buying'
import { NEEDS_ATTENTION, ReplenishmentSignal, ReplenishmentStatus, fetchReplenishmentSignals } from './replenishment'
import { fetchSalesValidationQueue } from './sales-validation'
import { isUrgentShipment, sortShipmentQueue } from './shipment-queue'
import { fetchWaitlistQueue } from './waitlist'

/**
 * Torre de Controle — a tela final do roadmap: as três pessoas da operação
 * respondem suas perguntas SÓ com o que já existe no sistema, sem planilha
 * paralela. Cada número aqui é um agregado de uma RPC/leitura já existente
 * (Fases 1-9) — a Torre não inventa dado novo, só organiza o que já está
 * lá por pergunta de quem precisa responder.
 */
export type ControlTowerSummary = {
  davi: { blockedSalesCount: number; recoveryCount: number; waitlistReadyCount: number; waitlistWaitingCount: number }
  ilde: { nextShipment: { id: string; recipientName: string; urgent: boolean } | null; queueLength: number; pendingPhysicalConference: number }
  gestao: { lowStockCount: number; strongOpportunityCount: number; marginPct: number | null; unpricedCount: number }
}

/** Correção final (ordenação SuperFrete/conferência física): a SuperFrete já avançou o envio externamente, mas o gate de post_shipment está bloqueado esperando o bipe do frasco/split — "operational exception", nunca um erro genérico (ver superfrete-sync-shipment). */
export function countPendingPhysicalConference(shipments: OperationalShipment[]): number {
  return shipments.filter((s) => s.integration_error === 'PHYSICAL_CONFERENCE_PENDING').length
}

/** "O que precisa ser comprado E vale a pena comprar agora?" — mesmo classificador determinístico da Fase 9 (radar-buying.ts), só aplicado a todos os perfumes de uma vez em vez de um por um. */
export function countStrongOpportunities(
  replenishment: ReplenishmentSignal[], margin: PerfumeMarginRow[], offers: RadarOffer[],
): number {
  const marginByPerfume = new Map(margin.map((row) => [row.perfume_id, row]))
  const offersByPerfume = new Map<string, RadarOffer[]>()
  for (const offer of offers) {
    if (!offer.perfume_id) continue
    const list = offersByPerfume.get(offer.perfume_id) ?? []
    list.push(offer)
    offersByPerfume.set(offer.perfume_id, list)
  }
  return replenishment.filter((signal) => {
    const marginRow = marginByPerfume.get(signal.perfume_id)
    const bestOffer = pickBestOffer(offersByPerfume.get(signal.perfume_id) ?? [])
    return classifyBuyingSignal({
      replenishmentStatus: signal.status, hasCost: marginRow?.has_cost ?? false, marginPct: marginRow?.margin_pct ?? null, bestOffer,
    }) === 'forte_oportunidade'
  }).length
}

function pickNextShipment(shipments: OperationalShipment[]) {
  const openQueue = sortShipmentQueue(shipments.filter((s) => s.status !== 'posted' && s.status !== 'delivered'))
  const next = openQueue[0]
  return {
    nextShipment: next ? { id: next.id, recipientName: next.clients?.name || next.recipient_name, urgent: isUrgentShipment(next) } : null,
    queueLength: openQueue.length,
  }
}

export async function fetchControlTowerSummary(): Promise<ControlTowerSummary> {
  const [blocked, recovery, waitlist, shipments, replenishment, margin, offers] = await Promise.all([
    fetchSalesValidationQueue(), fetchClientRecoveryQueue(), fetchWaitlistQueue(), fetchOperationalShipments(),
    fetchReplenishmentSignals(), fetchPerfumeMarginSummary(presetPeriod('month')), fetchOffersForPerfume({}),
  ])

  const marginTotals = summarizeMargin(margin)
  const { nextShipment, queueLength } = pickNextShipment(shipments)

  return {
    davi: {
      blockedSalesCount: blocked.length, recoveryCount: recovery.length,
      waitlistReadyCount: waitlist.filter((entry) => entry.ready).length,
      waitlistWaitingCount: waitlist.filter((entry) => entry.status === 'waiting').length,
    },
    ilde: { nextShipment, queueLength, pendingPhysicalConference: countPendingPhysicalConference(shipments) },
    gestao: {
      lowStockCount: replenishment.filter((signal) => (NEEDS_ATTENTION as ReplenishmentStatus[]).includes(signal.status)).length,
      strongOpportunityCount: countStrongOpportunities(replenishment, margin, offers),
      marginPct: marginTotals.revenue > 0 ? (marginTotals.margin / marginTotals.revenue) * 100 : null,
      unpricedCount: marginTotals.unpriced,
    },
  }
}
