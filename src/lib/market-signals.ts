import { STATUS_LABEL, NEEDS_ATTENTION, ReplenishmentSignal, ReplenishmentStatus, fetchReplenishmentSignals } from './replenishment'
import { WaitlistEntry, fetchWaitlistQueue } from './waitlist'

export type MarketSignalType = 'demanda_nao_atendida' | 'aceleracao_venda'
export type MarketSignal = {
  type: MarketSignalType; perfumeId: string; perfumeName: string; message: string; severity: 'alta' | 'media'
}

/**
 * Fase 10 — Market Signals. Briefing: "No aggressive scraping. No
 * uncontrolled cron. No expensive automated search... Prioritize signals
 * from: internal sales movement, internal demand, stock pressure,
 * waitlist demand, replenishment, margin, saved Radar observations...
 * AI does not invent deterministic facts." Zero new migration, zero
 * external call: só recompõe replenishment_signals (Reposição) e
 * waitlist_queue (Fase 6), os dois já existentes e read-only.
 */

/** Cliente esperando um perfume que está crítico ou pedindo reposição agora — o sinal mais acionável: alguém já quer comprar e o estoque está travando a venda. */
function unmetDemandSignals(waitlist: WaitlistEntry[], replenishment: ReplenishmentSignal[]): MarketSignal[] {
  const byPerfume = new Map(replenishment.map((signal) => [signal.perfume_id, signal]))
  const signals: MarketSignal[] = []
  for (const entry of waitlist) {
    if (entry.status !== 'waiting') continue
    const signal = byPerfume.get(entry.perfume_id)
    if (!signal || !(NEEDS_ATTENTION as ReplenishmentStatus[]).includes(signal.status)) continue
    signals.push({
      type: 'demanda_nao_atendida', perfumeId: entry.perfume_id, perfumeName: entry.perfume_name,
      message: `${entry.client_name} espera ${entry.perfume_name} — estoque ${STATUS_LABEL[signal.status].toLowerCase()}`,
      severity: 'alta',
    })
  }
  return signals
}

const ACCELERATION_THRESHOLD = 1.5

/** Ritmo dos últimos 7 dias claramente acima da média dos últimos 30 — "está vendendo mais rápido do que o normal agora", útil pra priorizar compra antes que vire crítico. Limiar de 1.5x é arbitrário mas documentado (não uma fração "redonda" escondida). */
function accelerationSignals(replenishment: ReplenishmentSignal[]): MarketSignal[] {
  const signals: MarketSignal[] = []
  for (const signal of replenishment) {
    if (signal.ml_7d <= 0 || signal.ml_30d <= 0) continue
    const recentDaily = signal.ml_7d / 7
    const baselineDaily = signal.ml_30d / 30
    if (baselineDaily <= 0) continue
    const ratio = recentDaily / baselineDaily
    if (ratio >= ACCELERATION_THRESHOLD) {
      signals.push({
        type: 'aceleracao_venda', perfumeId: signal.perfume_id, perfumeName: signal.perfume,
        message: `${signal.perfume} vendendo ${ratio.toFixed(1)}x mais rápido que a média recente`,
        severity: ratio >= ACCELERATION_THRESHOLD * 2 ? 'alta' : 'media',
      })
    }
  }
  return signals
}

export function computeMarketSignals(waitlist: WaitlistEntry[], replenishment: ReplenishmentSignal[]): MarketSignal[] {
  return [...unmetDemandSignals(waitlist, replenishment), ...accelerationSignals(replenishment)]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alta' ? -1 : 1))
}

export async function fetchMarketSignals(): Promise<MarketSignal[]> {
  const [waitlist, replenishment] = await Promise.all([fetchWaitlistQueue(), fetchReplenishmentSignals()])
  return computeMarketSignals(waitlist, replenishment)
}
