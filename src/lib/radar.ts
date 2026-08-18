import { currentOrganization, authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type RadarAvailability = 'in_stock'|'low_stock'|'out_of_stock'|'preorder'|'unknown'
export type RadarShipping = 'yes'|'no'|'unknown'
export type RadarSourceType = 'official_brand'|'authorized_retailer'|'retailer'|'distributor'|'marketplace'|'manual'

export type RadarWatchItem = {
  id:string;organization_id:string;perfume_id:string|null;brand:string;perfume_name:string
  size_ml:number|null;target_price_brl:number|null;priority:'low'|'normal'|'high';status:'active'|'paused'
  notes:string|null;created_by:string|null;created_at:string;last_search_at:string|null
}

export type RadarOffer = {
  id:string;organization_id:string;perfume_id:string|null;watch_item_id:string|null;source_id:string|null
  seller_name:string|null;domain:string|null;url:string;country_code:string|null;country_name:string|null
  raw_title:string|null;price_native:number;currency:string;price_brl:number|null;size_ml:number|null
  concentration:string|null;availability_status:RadarAvailability;shipping_to_brazil:RadarShipping
  shipping_notes:string|null;source_type:RadarSourceType|string|null;confidence_score:number|null
  first_seen_at:string;last_seen_at:string;last_checked_at:string;active:boolean;metadata:Record<string,unknown>
  entry_method:'manual'|'provider';source_name:string|null;source_trusted:boolean;score:number
}

export type RadarSource = {
  id:string;organization_id:string;name:string;domain:string|null;country_code:string|null
  source_type:RadarSourceType;priority:number;trusted:boolean;active:boolean;notes:string|null
  created_at:string;updated_at:string
}

export type RadarOfferSnapshot = { id:string;offer_id:string;price_native:number;currency:string;availability_status:RadarAvailability;checked_at:string }

export type RadarOfferAggregates = {
  total_offers:number
  by_availability:Record<string,number>
  by_currency:{currency:string;offers:number;min_price:number;max_price:number;median_price:number}[]
  sources_by_trust:Record<string,number>
  price_drops_since_last_check:number
  generated_at:string
}

export type SearchRelevance = 'exact'|'likely'|'weak'|'excluded'

export type ShoppingSearchResult = {
  title:string|null; seller_name:string|null; price_native:number|null; raw_price:string|null
  currency:string|null; product_id:string|null; source_url:string|null; merchant_url:string|null
  delivery:string|null; rating:number|null; reviews:number|null; availability_status:'unknown'
  provider?:string; relevance:SearchRelevance; source_type:'marketplace'|null; price_flag:'outlier'|null
}

export type RadarSearchResult = {
  available:boolean; message?:string; provider?:string; query?:string; market?:string
  requested_market?:string; provider_market?:string
  result_count?:number; relevant_count?:number; results?:ShoppingSearchResult[]; run_id?:string|null
}

export async function fetchWatchlist() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.from('radar_watchlist').select('*')
    .eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as RadarWatchItem[]
}

export async function createWatchItem(payload:{brand:string;perfume_name:string;size_ml?:number|null;target_price_brl?:number|null;priority?:'low'|'normal'|'high';perfume_id?:string|null;notes?:string|null}) {
  const { organizationId, user } = await currentOrganization()
  const { data, error } = await supabase!.from('radar_watchlist').insert({
    organization_id: organizationId, brand: payload.brand.trim(), perfume_name: payload.perfume_name.trim(),
    size_ml: payload.size_ml ?? null, target_price_brl: payload.target_price_brl ?? null,
    priority: payload.priority ?? 'normal', perfume_id: payload.perfume_id ?? null,
    notes: payload.notes ?? null, created_by: user.id,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as RadarWatchItem
}

export async function updateWatchStatus(id:string, status:'active'|'paused') {
  await currentOrganization()
  const { data, error } = await supabase!.rpc('radar_toggle_watch', { p_watch_id: id, p_status: status })
  if (error) throw new Error(error.message)
  return data as RadarWatchItem
}

export async function removeWatchItem(id:string) {
  await currentOrganization()
  const { error } = await supabase!.from('radar_watchlist').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchOffersForPerfume(params:{ perfumeId?:string|null; watchItemId?:string|null }) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('radar_offers_for_perfume', {
    org_id: organizationId, p_perfume_id: params.perfumeId ?? null, p_watch_item_id: params.watchItemId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as RadarOffer[]
}

export type ManualOfferInput = {
  url:string; price_native:number; currency:string; seller_name?:string; domain?:string
  country_code?:string; country_name?:string; raw_title?:string; size_ml?:number|null
  concentration?:string; availability_status?:RadarAvailability; shipping_to_brazil?:RadarShipping
  shipping_notes?:string; source_type?:string; source_id?:string|null
  perfume_id?:string|null; watch_item_id?:string|null
}

export function validateManualOffer(payload:ManualOfferInput) {
  if (!payload.url?.trim() || !/^https?:\/\//i.test(payload.url.trim())) throw new Error('Informe a URL da fonte.')
  if (!(payload.price_native >= 0)) throw new Error('Informe um preço válido.')
  if (!/^[A-Za-z]{3}$/.test(payload.currency ?? '')) throw new Error('Informe a moeda em 3 letras (ex.: EUR).')
}

export async function addManualOffer(payload:ManualOfferInput) {
  validateManualOffer(payload)
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!.rpc('radar_save_manual_offer', {
    p_payload: { ...payload, organization_id: organizationId },
  })
  if (error) throw new Error(error.message)
  return data as RadarOffer
}

export async function fetchSources() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.from('radar_sources').select('*')
    .eq('organization_id', organizationId).order('priority', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as RadarSource[]
}

export async function createSource(payload:{name:string;domain?:string;country_code?:string;source_type:RadarSourceType;trusted?:boolean;priority?:number;notes?:string}) {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!.from('radar_sources').insert({
    organization_id: organizationId, name: payload.name.trim(), domain: payload.domain?.trim().toLowerCase() || null,
    country_code: payload.country_code?.trim().toUpperCase() || null, source_type: payload.source_type,
    trusted: payload.trusted ?? false, priority: payload.priority ?? 0, notes: payload.notes ?? null,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as RadarSource
}

export async function fetchRadarRole() {
  const { role } = await authenticatedOrganization()
  return role as 'admin'|'manager'|'operator'|'viewer'
}

export type RadarSeedResult = { inserted:number; updated:number; total:number }

// Só admin/manager conseguem executar (validado no RPC). Idempotente: pode ser chamada
// várias vezes sem duplicar fontes — chave natural organization_id+domain.
export async function seedInitialSources() {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!.rpc('radar_seed_initial_sources', { p_org_id: organizationId })
  if (error) throw new Error(error.message)
  return data as RadarSeedResult
}

export function formatSeedResult(result:RadarSeedResult) {
  return result.inserted > 0 ? `${result.total} fontes disponíveis no Radar.` : 'Fontes iniciais já configuradas.'
}

export type PromoteSourceInput = {
  domain:string; name?:string; country_code?:string
  source_type:'official_brand'|'authorized_retailer'|'retailer'|'distributor'|'marketplace'
  trusted?:boolean; priority?:number; notes?:string
}

// A descoberta automática (SerpAPI) nunca chama isso sozinha: promover uma fonte é sempre
// uma ação explícita de admin/manager, e trusted só vira true se marcado explicitamente.
export async function promoteSource(payload:PromoteSourceInput) {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!.rpc('radar_promote_source', {
    p_payload: { ...payload, organization_id: organizationId },
  })
  if (error) throw new Error(error.message)
  return data as RadarSource
}

export async function fetchOfferSnapshots(offerId:string) {
  const { data, error } = await supabase!.from('radar_offer_snapshots').select('*')
    .eq('offer_id', offerId).order('checked_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as RadarOfferSnapshot[]
}

export async function searchRadar(payload:{query:string;brand:string;perfume_name:string;size_ml?:number|null;watch_item_id?:string|null}) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.functions.invoke('radar-search', { body: { organization_id: organizationId, ...payload } })
  if (error) {
    const response = (error as { context?:Response }).context
    let message = 'Não foi possível buscar oportunidades agora.'
    try { const body = await response?.clone().json(); message = body?.error?.message ?? message } catch { /* resposta sem JSON */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error.message)
  return data.data as RadarSearchResult
}

export async function summarizeRadar(payload:{ perfume_id?:string|null; watch_item_id?:string|null }) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.functions.invoke('radar-summary', { body: { organization_id: organizationId, ...payload } })
  if (error) {
    const response = (error as { context?:Response }).context
    let message = 'Não foi possível gerar a análise agora.'
    try { const body = await response?.clone().json(); message = body?.error?.message ?? message } catch { /* resposta sem JSON */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error.message)
  return data.data as { resumo:string; menor_preco_por_moeda:{moeda:string;valor:string}[]; ofertas_disponiveis:number; quedas_de_preco:number; alertas:string[]; data_geracao:string }
}

// Marcas conhecidas do catálogo RUAH. Usadas para reconhecer a marca em qualquer posição do
// texto digitado (início, fim, meio) sem reordenar palavras — só extraímos o trecho reconhecido.
const KNOWN_BRANDS = [
  'Amouage', 'Xerjoff', 'Nishane', 'Initio Parfums Privés', 'Initio', 'Parfums de Marly',
  'Maison Francis Kurkdjian', 'Roja Dove', 'Roja', 'Tom Ford', 'Creed', 'Mancera', 'Montale',
  'By Kilian', 'Kilian', 'Memo Paris', 'Memo', 'Frederic Malle', 'Byredo', 'Diptyque', 'Le Labo',
  'Bond No 9', 'Clive Christian', 'Ex Nihilo', 'Orto Parisi', 'Vertus', 'Areej Le Doré',
  'Boadicea the Victorious', 'Boadicea', 'Fragrance Du Bois',
].sort((a, b) => b.length - a.length)

function escapeRegExp(value:string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Só remove espaços redundantes — nunca reordena as palavras do que foi digitado.
export function normalizeSearchQuery(raw:string) {
  return raw.trim().replace(/\s+/g, ' ')
}

export function parsePerfumeQuery(raw:string) {
  const value = normalizeSearchQuery(raw)
  const sizeMatch = value.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i)
  const sizeMl = sizeMatch ? Number(sizeMatch[1].replace(',', '.')) : null
  const withoutSize = normalizeSearchQuery(value.replace(sizeMatch?.[0] ?? '', ''))

  for (const candidate of KNOWN_BRANDS) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(candidate)}(\\s|$)`, 'i')
    if (pattern.test(withoutSize)) {
      const perfumeName = normalizeSearchQuery(withoutSize.replace(pattern, ' '))
      return { brand: candidate, perfumeName, sizeMl }
    }
  }

  const dashSplit = withoutSize.split(/\s+[—–-]\s+/)
  if (dashSplit.length === 2) return { brand: dashSplit[1].trim(), perfumeName: dashSplit[0].trim(), sizeMl }

  // Sem marca reconhecida: mantém a heurística de fallback (última palavra = marca).
  const parts = withoutSize.split(' ').filter(Boolean)
  const brand = parts.length > 1 ? parts[parts.length - 1] : ''
  const perfumeName = parts.length > 1 ? parts.slice(0, -1).join(' ') : withoutSize
  return { brand, perfumeName, sizeMl }
}
