import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type BottleTrackingStatus = 'untracked'|'onboarding'|'active'
export type BottleStatus = 'active'|'empty'|'retired'

export type InventoryBottle = {
  id:string; organization_id:string; inventory_item_id:string; perfume_id:string
  bottle_code:string; bottle_label:string; barcode_value:string; qr_token:string
  physical_ml:number; apc_unit_available:boolean; status:BottleStatus
  created_by:string|null; created_at:string; updated_at:string
}

export type BottleResolution = {
  bottle_id:string; bottle_code:string; bottle_label:string; physical_ml:number; apc_unit_available:boolean
  status:BottleStatus; updated_at:string; perfume_name:string; brand_house:string|null
  inventory_item_id:string; item_available_ml:number
}

export type TrackingPreviewBottle = {
  id:string; bottle_code:string; bottle_label:string; physical_ml:number
  apc_unit_available:boolean; status:BottleStatus; updated_at:string
}

export type TrackingPreview = {
  inventory_item_id:string; perfume_name:string; brand_house:string|null
  bottle_tracking_status:BottleTrackingStatus; system_ml:number; identified_ml:number
  bottles:TrackingPreviewBottle[]
}

export type ConferenceHistoryEntry = {
  conferred_at:string; ml_after:number; apc_after:boolean; conferred_by_name:string
}

export type ConferenceResult = {
  bottle_id:string; physical_ml:number; apc_unit_available:boolean; status:BottleStatus
  updated_at:string; delta:number; conference_id:string
}

/** Deep link a printed QR encodes. Resolution/tenant check happens server-side on scan. */
export function bottleDeepLink(token:string) {
  return `${location.origin}/q/${token}`
}

export async function resolveBottleByToken(token:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_resolve_token', { p_token: token })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as BottleResolution[]
  return rows[0] ?? null
}

export async function resolveBottleByCode(value:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_resolve_code', { p_value: value })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as BottleResolution[]
  return rows[0] ?? null
}

export async function confirmBottleConference(bottleId:string, observedMl:number, apcAvailable:boolean, expectedUpdatedAt:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_confirm_conference', {
    p_bottle_id: bottleId, p_observed_ml: observedMl, p_apc_available: apcAvailable, p_expected_updated_at: expectedUpdatedAt,
  })
  if (error) {
    if (error.message.includes('stale_conference')) throw new Error('Este estoque foi atualizado depois que você abriu a tela. Confira novamente.')
    throw new Error(error.message)
  }
  return data as ConferenceResult
}

export async function generateBottle(inventoryItemId:string, bottleLabel:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_generate', { p_inventory_item_id: inventoryItemId, p_bottle_label: bottleLabel })
  if (error) throw new Error(error.message)
  return data as InventoryBottle
}

export async function addNewBottleAfterActive(inventoryItemId:string, ml:number, bottleLabel:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_add_new', { p_inventory_item_id: inventoryItemId, p_ml: ml, p_bottle_label: bottleLabel })
  if (error) throw new Error(error.message)
  return data as InventoryBottle
}

export async function fetchTrackingPreview(inventoryItemId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_tracking_preview', { p_inventory_item_id: inventoryItemId })
  if (error) throw new Error(error.message)
  return data as TrackingPreview
}

export async function finalizeTracking(inventoryItemId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_finalize_tracking', { p_inventory_item_id: inventoryItemId })
  if (error) {
    const match = error.message.match(/tracking_reconciliation_mismatch: sistema=([\d.]+) identificado=([\d.]+) diferenca=(-?[\d.]+)/)
    if (match) throw new Error(`Ainda há diferença entre o sistema (${match[1]} ml) e o identificado (${match[2]} ml): ${match[3]} ml. Ajuste antes de finalizar.`)
    throw new Error(error.message)
  }
  return data
}

export async function revokeBottleQr(bottleId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_revoke_qr', { p_bottle_id: bottleId })
  if (error) throw new Error(error.message)
  return data as InventoryBottle
}

export async function fetchConferenceHistory(bottleId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottle_conference_history', { p_bottle_id: bottleId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ConferenceHistoryEntry[]
}

export async function fetchBottlesForItem(inventoryItemId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_bottles_for_item', { p_inventory_item_id: inventoryItemId })
  if (error) throw new Error(error.message)
  return (data ?? []) as InventoryBottle[]
}

// Priority 0B — identidade física do SPLIT (vidro fracionado a partir de um frasco fonte). Terceiro objeto: PERFUME (produto) / FRASCO FONTE (acima) / SPLIT (abaixo) — nunca confundidos.
export type SplitUnitStatus = 'available'|'consumed'|'void'

export type InventorySplitUnit = {
  id:string; organization_id:string; perfume_id:string; inventory_item_id:string; source_bottle_id:string
  split_code:string; barcode_value:string; quantity_ml:number; status:SplitUnitStatus
  created_by:string|null; created_at:string; consumed_at:string|null
}

/** Fracionar é transferência física interna (nunca entrada de estoque): decrementa o frasco fonte, nunca o pooled do perfume. Atômico no banco — sem escrita nenhuma antes desta chamada (o preview é só aritmética local). */
export async function splitBottle(sourceBottleId:string, quantityMl:number, count:number) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_split_bottle', { p_source_bottle_id: sourceBottleId, p_quantity_ml: quantityMl, p_count: count })
  if (error) throw new Error(error.message)
  return (data ?? []) as InventorySplitUnit[]
}

export async function fetchSplitUnitsForBottle(sourceBottleId:string) {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('inventory_split_units_for_bottle', { p_source_bottle_id: sourceBottleId })
  if (error) throw new Error(error.message)
  return (data ?? []) as InventorySplitUnit[]
}

export type SplitResolution = {
  split_id:string; split_code:string; barcode_value:string; quantity_ml:number; status:SplitUnitStatus
  perfume_name:string; brand_house:string|null; source_bottle_id:string; source_bottle_code:string
}

type SplitResolveRow = {
  id:string; split_code:string; barcode_value:string; quantity_ml:number; status:SplitUnitStatus; source_bottle_id:string
  perfumes:{ base_name:string; brand_house:string|null } | { base_name:string; brand_house:string|null }[] | null
  inventory_bottles:{ bottle_code:string } | { bottle_code:string }[] | null
}

/**
 * Não existe (ainda) um RPC dedicado para resolver um split isolado por
 * código — só shipment_item_scan_bottle (escopado a um envio). Em vez de
 * criar uma migration/RPC nova só para isto, reaproveita a policy de
 * leitura já existente (RLS por organization_id, 202608190007) via select
 * direto — nenhuma escrita, nenhum schema novo, mesma garantia de
 * isolamento por tenant que qualquer outra leitura já tem.
 */
export async function resolveSplitByCode(value:string) {
  const { organizationId } = await authenticatedOrganization()
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z0-9-]{1,32}$/.test(normalized)) return null
  const { data, error } = await supabase!
    .from('inventory_split_units')
    .select('id,split_code,barcode_value,quantity_ml,status,source_bottle_id,perfumes(base_name,brand_house),inventory_bottles(bottle_code)')
    .eq('organization_id', organizationId)
    .or(`barcode_value.eq.${normalized},split_code.eq.${normalized}`)
    .maybeSingle<SplitResolveRow>()
  if (error) throw new Error(error.message)
  if (!data) return null
  const perfume = Array.isArray(data.perfumes) ? data.perfumes[0] : data.perfumes
  const bottle = Array.isArray(data.inventory_bottles) ? data.inventory_bottles[0] : data.inventory_bottles
  return {
    split_id: data.id, split_code: data.split_code, barcode_value: data.barcode_value,
    quantity_ml: data.quantity_ml, status: data.status,
    perfume_name: perfume?.base_name ?? '', brand_house: perfume?.brand_house ?? null,
    source_bottle_id: data.source_bottle_id, source_bottle_code: bottle?.bottle_code ?? '',
  } as SplitResolution
}
