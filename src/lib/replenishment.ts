import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type ReplenishmentStatus = 'critico'|'repor'|'atencao'|'saudavel'|'sem_dados'

export type ReplenishmentSignal = {
  item_id:string; perfume_id:string; perfume:string; brand_house:string|null
  base_name:string; bottle_identifier:string|null
  available_ml:number; minimum_ml:number; physical_ml:number; reconciliation_status:string
  ml_7d:number; ml_30d:number; ml_60d:number; ml_90d:number
  sales_count_7d:number; sales_count_30d:number; sales_count_90d:number
  last_sale_at:string|null
  velocity_ml_per_day:number|null; coverage_days:number|null
  status:ReplenishmentStatus; priority_score:number
}

export async function fetchReplenishmentSignals() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('replenishment_signals', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ReplenishmentSignal[]
}

export type ReplenishmentSummary = { resumo:string; status:ReplenishmentStatus; ai_generated:boolean }

export async function summarizeReplenishment(itemId:string) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.functions.invoke('replenishment-summary', {
    body: { organization_id: organizationId, item_id: itemId },
  })
  if (error) {
    const response = (error as { context?:Response }).context
    let message = 'Não foi possível gerar a análise agora.'
    try { const body = await response?.clone().json(); message = body?.error?.message ?? message } catch { /* resposta sem JSON */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error.message)
  return data.data as ReplenishmentSummary
}

// Constrói a query do Radar a partir da identidade canônica do perfume (marca + nome base),
// só acrescentando tamanho quando existir uma referência segura em bottle_identifier — nunca
// inventa tamanho (item 10 do spec).
export function buildRadarQuery(signal:Pick<ReplenishmentSignal,'perfume'|'brand_house'|'base_name'|'bottle_identifier'>) {
  const name = (signal.base_name || signal.perfume || '').trim()
  const brand = (signal.brand_house || '').trim()
  const sizeMatch = (signal.bottle_identifier || '').match(/(\d+(?:[.,]\d+)?)\s*ml/i)
  const size = sizeMatch ? `${sizeMatch[1].replace(',', '.')}ml` : ''
  return [name, brand, size].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function goToRadarWithQuery(query:string) {
  history.pushState({}, '', `/radar?q=${encodeURIComponent(query)}`)
  dispatchEvent(new PopStateEvent('popstate'))
}

export function goToReplenishment() {
  history.pushState({}, '', '/estoque/reposicao')
  dispatchEvent(new PopStateEvent('popstate'))
}

export const STATUS_LABEL:Record<ReplenishmentStatus,string> = {
  critico: 'CRÍTICO', repor: 'REPOR', atencao: 'ATENÇÃO', saudavel: 'SAUDÁVEL', sem_dados: 'SEM DADOS',
}

export const NEEDS_ATTENTION:ReplenishmentStatus[] = ['critico', 'repor']

const STATUS_PHRASE:Record<ReplenishmentStatus,string> = {
  critico: 'está crítico', repor: 'merece reposição', atencao: 'está em atenção',
  saudavel: 'está saudável', sem_dados: 'ainda não tem histórico de vendas suficiente',
}

// Espelha buildDeterministicSummary do backend (supabase/functions/_shared/replenishment-domain.ts)
// para exibição instantânea no card, sem chamada de rede. Nunca inventa número — só narra o
// que já veio da RPC. A versão do backend é a autoridade para a análise "IA" sob demanda;
// esta é só a leitura imediata da mesma fórmula, mantidas em sincronia deliberadamente.
export function formatReplenishmentSummary(signal:Pick<ReplenishmentSignal,'perfume'|'status'|'available_ml'|'ml_30d'|'coverage_days'>) {
  if (signal.status === 'sem_dados') {
    return `${signal.perfume} ainda não tem histórico de vendas suficiente para uma recomendação. Restam ${Number(signal.available_ml).toLocaleString('pt-BR')} ml disponíveis.`
  }
  const parts = [`${signal.perfume} ${STATUS_PHRASE[signal.status]}. `, `Restam ${Number(signal.available_ml).toLocaleString('pt-BR')} ml disponíveis`]
  if (signal.ml_30d > 0) parts.push(` e foram vendidos ${Number(signal.ml_30d).toLocaleString('pt-BR')} ml nos últimos 30 dias.`)
  else parts.push('.')
  if (signal.coverage_days != null) {
    const rounded = Math.max(0, Math.round(signal.coverage_days))
    parts.push(` No ritmo recente, o estoque atual tem cobertura estimada de ${rounded} dia${rounded === 1 ? '' : 's'}.`)
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}
