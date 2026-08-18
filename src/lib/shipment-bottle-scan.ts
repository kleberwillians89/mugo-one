import { BottleScanResult } from './records'
import { formatMl } from './bottle-scan'

/** Human-facing message for every outcome of shipment_item_scan_bottle — never a raw error code (briefing: "⚠ FRASCO DIFERENTE", not a technical message). */
export function describeBottleScanResult(result: BottleScanResult): { tone: 'success'|'error'; message: string } {
  if (result.ok) return { tone: 'success', message: `Frasco ${result.bottle_code} vinculado — ${formatMl(result.physical_ml)} disponíveis.` }
  switch (result.reason) {
    case 'bottle_not_found': return { tone: 'error', message: 'Não reconhecemos este frasco.' }
    case 'wrong_perfume': return { tone: 'error', message: `⚠ FRASCO DIFERENTE — ${result.bottle_label ?? result.bottle_code ?? 'este frasco'} é de outro perfume.` }
    case 'bottle_unavailable': return { tone: 'error', message: result.status === 'empty' ? 'Este frasco está marcado como vazio.' : 'Este frasco não está disponível.' }
    case 'insufficient_ml': return { tone: 'error', message: `Este frasco só tem ${formatMl(result.available_ml ?? 0)} — o pedido precisa de ${formatMl(result.needed_ml ?? 0)}.` }
    case 'bottle_already_assigned': return { tone: 'error', message: 'Este frasco já está separado para outro envio.' }
    case 'not_bottle_tracked': return { tone: 'error', message: 'Este item não usa identidade física de frasco.' }
    default: return { tone: 'error', message: 'Não foi possível vincular este frasco.' }
  }
}

/** Whether a shipment item's underlying perfume has adopted bottle identity — controls whether the scan UI shows at all. */
export function isBottleTrackedItem(item: { inventory_allocations: { stock_managed: boolean; inventory_items: { bottle_tracking_status: string } | null } | null }): boolean {
  return Boolean(item.inventory_allocations?.stock_managed && item.inventory_allocations.inventory_items?.bottle_tracking_status === 'active')
}

type BottleTrackedShipmentItem = Parameters<typeof isBottleTrackedItem>[0] & { bottle_id: string | null; sales: { perfume_name_raw: string | null } | null }

/** Fase 3 (Final Shipping Audit) input: which bottle-tracked items still need a bottle scanned before this order can ship. */
export function unassignedBottleItems<T extends BottleTrackedShipmentItem>(items: T[]): T[] {
  return items.filter((item) => isBottleTrackedItem(item) && !item.bottle_id)
}
