import type { SplitStatusItem } from './records'

export type SplitPrintGroup = { key: string; perfume_name: string; brand_house: string | null; items: SplitStatusItem[]; total_ml: number }

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

export function splitPrintSummary(items: SplitStatusItem[], groups: SplitPrintGroup[]) {
  return {
    perfumes: groups.length,
    splits: items.length,
    clients: new Set(items.map((item) => item.client_id)).size,
    ml_total: groups.reduce((sum, group) => sum + group.total_ml, 0),
  }
}
