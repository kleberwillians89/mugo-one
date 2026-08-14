import type {AiSalesBatchGroup,OperationalInventoryRow} from './records'

export const normalizeInventoryPerfumeName=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s*\(\s*frasco\s+\d+\s*\)\s*$/i,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

export function reconcileInventoryGroup(group:AiSalesBatchGroup,items:OperationalInventoryRow[]):AiSalesBatchGroup{
  const normalized=group.normalized_perfume_name||normalizeInventoryPerfumeName(group.raw_perfume_name||group.perfume),exact=items.filter(item=>normalizeInventoryPerfumeName(item.perfume)===normalized)
  if(exact.length===1)return{...group,inventory_item_id:exact[0].item_id,perfume_id:exact[0].perfume_id,inventory:exact[0],perfume_match_status:'found'}
  const suggestions=exact.length?exact:items.filter(item=>{const candidate=normalizeInventoryPerfumeName(item.perfume);return candidate.includes(normalized)||normalized.includes(candidate)})
  if(suggestions.length===1)return{...group,inventory_item_id:suggestions[0].item_id,perfume_id:suggestions[0].perfume_id,inventory:suggestions[0],perfume_match_status:'found'}
  return{...group,inventory_item_id:null,inventory:null,perfume_match_status:suggestions.length?'review':group.perfume_match_status==='found'?'found':'new'}
}
