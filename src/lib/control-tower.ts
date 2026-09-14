import { PerfumeMarginRow, fetchPerfumeMarginSummary, summarizeMargin } from './cost-margin'
import { presetPeriod } from './period'
import { fetchClientRecoveryQueue } from './client-recovery'
import { CollectionSaleRow, OperationalShipment, SplitStatusCards, fetchCollectionsPending, fetchOperationalShipments, fetchReservedAllocations, fetchSplitStatusCards } from './records'
import { RadarOffer, fetchOffersForPerfume } from './radar'
import { classifyBuyingSignal, pickBestOffer } from './radar-buying'
import { NEEDS_ATTENTION, ReplenishmentSignal, ReplenishmentStatus, fetchReplenishmentSignals } from './replenishment'
import { fetchSalesValidationQueue } from './sales-validation'
import { isUrgentShipment, sortShipmentQueue } from './shipment-queue'
import { fetchWaitlistQueue } from './waitlist'
import {countClientsMissingShippingData,summarizeShippingTasks} from './shipping-tasks'

/**
 * Torre de Controle — a tela final do roadmap: as três pessoas da operação
 * respondem suas perguntas SÓ com o que já existe no sistema, sem planilha
 * paralela. Cada número aqui é um agregado de uma RPC/leitura já existente
 * (Fases 1-9) — a Torre não inventa dado novo, só organiza o que já está
 * lá por pergunta de quem precisa responder.
 */
export type ControlTowerSummary = {
  davi: { blockedSalesCount: number; awaitingPaymentSales: number; clientsMissingShippingData: number; recoveryCount: number; waitlistReadyCount: number; waitlistWaitingCount: number } | null
  gabriel: SplitStatusCards | null
  entregas: {
    nextShipment: { id: string; recipientName: string; urgent: boolean } | null
    queueLength: number
    paidWaitingClients: number
    nextWaitingSaleId: string | null
    awaitingQuote: number
    awaitingApproval: number
    awaitingConference: number
    labelsToIssue: number
    readyToPost: number
    pendingPhysicalConference: number
  } | null
  gestao: { lowStockCount: number; strongOpportunityCount: number; marginPct: number | null; unpricedCount: number } | null
}

export type ControlTowerScope = { sales: boolean; split: boolean; shipping: boolean; management: boolean }

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

export async function fetchControlTowerSummary(scope:ControlTowerScope={sales:true,split:true,shipping:true,management:true}): Promise<ControlTowerSummary> {
  const [blocked, recovery, waitlist, collections, split, shipments, allocations, replenishment, margin, offers] = await Promise.all([
    scope.sales?fetchSalesValidationQueue():Promise.resolve([]), scope.sales?fetchClientRecoveryQueue():Promise.resolve([]),
    scope.sales?fetchWaitlistQueue():Promise.resolve([]), scope.sales?fetchCollectionsPending():Promise.resolve([] as CollectionSaleRow[]),
    scope.split?fetchSplitStatusCards():Promise.resolve(null),
    scope.sales||scope.shipping?fetchOperationalShipments():Promise.resolve([]), scope.shipping?fetchReservedAllocations():Promise.resolve([]),
    scope.management?fetchReplenishmentSignals():Promise.resolve([]),
    scope.management?fetchPerfumeMarginSummary(presetPeriod('month')):Promise.resolve([]),
    scope.management?fetchOffersForPerfume({}):Promise.resolve([]),
  ])

  const marginTotals = summarizeMargin(margin)
  const { nextShipment, queueLength } = pickNextShipment(shipments)
  const shippingTasks=summarizeShippingTasks(shipments,allocations)

  return {
    davi: scope.sales?{
      blockedSalesCount: blocked.length, awaitingPaymentSales:collections.length,
      clientsMissingShippingData:countClientsMissingShippingData(shipments), recoveryCount: recovery.length,
      waitlistReadyCount: waitlist.filter((entry) => entry.ready).length,
      waitlistWaitingCount: waitlist.filter((entry) => entry.status === 'waiting').length,
    }:null,
    gabriel: split,
    entregas: scope.shipping?{ nextShipment, queueLength, ...shippingTasks, pendingPhysicalConference: countPendingPhysicalConference(shipments) }:null,
    gestao: scope.management?{
      lowStockCount: replenishment.filter((signal) => (NEEDS_ATTENTION as ReplenishmentStatus[]).includes(signal.status)).length,
      strongOpportunityCount: countStrongOpportunities(replenishment, margin, offers),
      marginPct: marginTotals.revenue > 0 ? (marginTotals.margin / marginTotals.revenue) * 100 : null,
      unpricedCount: marginTotals.unpriced,
    }:null,
  }
}
