import type { SplitStatusItem } from './records'

export type SplitPrintGroup = { key: string; perfume_name: string; brand_house: string | null; items: SplitStatusItem[]; total_ml: number }
export type SplitPrintClientGroup = { key: string; client_id: string; client_name: string; client_number: number | null; items: SplitStatusItem[]; total_ml: number; pending: number; separated: number }

export function groupSplitItemsByPerfume(items: SplitStatusItem[]): SplitPrintGroup[] {
  const byPerfume = new Map<string, SplitPrintGroup>()
  for (const item of items) {
    const key = `${item.sale_type}:${item.perfume_id ?? item.perfume_name ?? '—'}`
    if (!byPerfume.has(key)) byPerfume.set(key, { key, perfume_name: item.perfume_name ?? '(sem perfume)', brand_house: item.brand_house, items: [], total_ml: 0 })
    const group = byPerfume.get(key)!
    group.items.push(item)
    group.total_ml += Number(item.volume_ml ?? 0)
  }
  return [...byPerfume.values()].sort((a, b) => a.perfume_name.localeCompare(b.perfume_name, 'pt-BR'))
}

export function groupSplitItemsByClient(items: SplitStatusItem[]): SplitPrintClientGroup[] {
  const byClient = new Map<string, SplitPrintClientGroup>()
  for (const item of items) {
    const key = item.client_id
    if (!byClient.has(key)) byClient.set(key, { key, client_id:item.client_id, client_name:item.client_name, client_number:item.client_number, items:[], total_ml:0, pending:0, separated:0 })
    const group=byClient.get(key)!
    group.items.push(item)
    group.total_ml+=Number(item.volume_ml??0)
    if(item.split_status==='split')group.separated+=1
    else group.pending+=1
  }
  for(const group of byClient.values())group.items.sort((a,b)=>(a.perfume_name??'').localeCompare(b.perfume_name??'','pt-BR',{sensitivity:'base'})||String(a.bottle_identifier??'').localeCompare(String(b.bottle_identifier??''),'pt-BR',{numeric:true}))
  return[...byClient.values()].sort((a,b)=>a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'}))
}

export function splitPrintSummary(items: SplitStatusItem[], groups: SplitPrintGroup[]) {
  return {
    perfumes: new Set(items.map(item=>item.perfume_id??item.perfume_name??'—')).size,
    splits: items.length,
    clients: new Set(items.map((item) => item.client_id)).size,
    ml_total: groups.reduce((sum, group) => sum + group.total_ml, 0),
  }
}
