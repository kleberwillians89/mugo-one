// RUAH — Inteligência de Reposição: tradução determinística dos sinais calculados em SQL
// (public.replenishment_signals) para uma frase em português. Função pura — nunca recalcula
// número nenhum, só narra o que já veio pronto do banco. Usada tanto como fallback quando a
// IA não está configurada quanto como texto de referência enviado ao modelo (que não pode
// contradizer estes números).

export type ReplenishmentStatus = 'critico' | 'repor' | 'atencao' | 'saudavel' | 'sem_dados'

export type ReplenishmentSignalRow = {
  item_id: string; perfume_id: string; perfume: string; brand_house: string | null
  base_name: string; bottle_identifier: string | null
  available_ml: number; minimum_ml: number; physical_ml: number; reconciliation_status: string
  ml_7d: number; ml_30d: number; ml_60d: number; ml_90d: number
  sales_count_7d: number; sales_count_30d: number; sales_count_90d: number
  last_sale_at: string | null
  velocity_ml_per_day: number | null; coverage_days: number | null
  status: ReplenishmentStatus
  priority_score: number
}

const STATUS_PHRASE: Record<ReplenishmentStatus, string> = {
  critico: 'está crítico', repor: 'merece reposição', atencao: 'está em atenção',
  saudavel: 'está saudável', sem_dados: 'ainda não tem histórico de vendas suficiente',
}

function formatMl(value: number): string {
  return `${Number(value).toLocaleString('pt-BR')} ml`
}

function formatDays(value: number): string {
  const rounded = Math.max(0, Math.round(value))
  return `${rounded} dia${rounded === 1 ? '' : 's'}`
}

export function buildDeterministicSummary(signal: ReplenishmentSignalRow): string {
  const name = signal.perfume
  if (signal.status === 'sem_dados') {
    return `${name} ainda não tem histórico de vendas suficiente para uma recomendação. Restam ${formatMl(signal.available_ml)} disponíveis.`
  }
  const parts = [`${name} ${STATUS_PHRASE[signal.status]}. `, `Restam ${formatMl(signal.available_ml)} disponíveis`]
  if (signal.ml_30d > 0) parts.push(` e foram vendidos ${formatMl(signal.ml_30d)} nos últimos 30 dias.`)
  else parts.push('.')
  if (signal.coverage_days != null) {
    parts.push(` No ritmo recente, o estoque atual tem cobertura estimada de ${formatDays(signal.coverage_days)}.`)
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}
