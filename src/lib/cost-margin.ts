import { PeriodValue } from './period'
import { authenticatedOrganization } from './records'
import { supabase } from './supabase'
import { operationalPeriod } from './operational-sales'

export type PerfumeMarginRow = {
  perfume_id: string; perfume_name: string; units_sold: number; total_ml: number; revenue: number
  average_cost_per_ml: number | null; known_cost: number | null; margin: number | null
  margin_pct: number | null; has_cost: boolean
}

export async function fetchPerfumeMarginSummary(period: PeriodValue) {
  const { organizationId } = await authenticatedOrganization()
  const operational = operationalPeriod(period)
  const { data, error } = await supabase!.rpc('perfume_margin_summary', { org_id: organizationId, start_date: operational.start, end_date: operational.end })
  if (error) throw new Error(error.message)
  return (data ?? []) as PerfumeMarginRow[]
}

export async function setPerfumeCost(perfumeId: string, costPerMl: number | null) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('perfume_set_cost', { p_perfume_id: perfumeId, p_cost_per_ml: costPerMl })
  if (error) throw new Error(error.message)
}

export function goToMarginReport() {
  history.pushState({}, '', '/relatorios/margem')
  dispatchEvent(new PopStateEvent('popstate'))
}

export function marginTone(marginPct: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (marginPct === null) return 'neutral'
  if (marginPct < 0) return 'danger'
  if (marginPct < 20) return 'warning'
  return 'success'
}

export type MarginTotals = { revenue: number; knownCost: number; margin: number; unpriced: number }

/** Soma só o que tem custo informado — receita/margem nunca fingem incluir o que não foi custeado. */
export function summarizeMargin(rows: PerfumeMarginRow[]): MarginTotals {
  return rows.reduce((totals, row) => ({
    revenue: totals.revenue + row.revenue,
    knownCost: totals.knownCost + (row.known_cost ?? 0),
    margin: totals.margin + (row.margin ?? 0),
    unpriced: totals.unpriced + (row.has_cost ? 0 : 1),
  }), { revenue: 0, knownCost: 0, margin: 0, unpriced: 0 })
}
