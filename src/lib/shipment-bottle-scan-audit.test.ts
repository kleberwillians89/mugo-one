import { describe, expect, it } from 'vitest'
import { unassignedBottleItems } from './shipment-bottle-scan'

const tracked = (bottleId: string | null, perfume = 'Naxos') => ({
  bottle_id: bottleId,
  sales: { perfume_name_raw: perfume },
  inventory_allocations: { stock_managed: true, inventory_items: { bottle_tracking_status: 'active' } },
})
const untracked = (bottleId: string | null = null) => ({
  bottle_id: bottleId,
  sales: { perfume_name_raw: 'Legado' },
  inventory_allocations: { stock_managed: true, inventory_items: { bottle_tracking_status: 'onboarding' } },
})

describe('unassignedBottleItems (Fase 3 — Final Shipping Audit)', () => {
  it('retorna itens rastreados sem frasco vinculado', () => {
    const items = [tracked(null), tracked('bottle-1')]
    expect(unassignedBottleItems(items)).toEqual([tracked(null)])
  })
  it('ignora itens não rastreados por frasco, mesmo sem bottle_id (zero regressão)', () => {
    expect(unassignedBottleItems([untracked()])).toEqual([])
  })
  it('lista vazia quando tudo já foi bipado', () => {
    expect(unassignedBottleItems([tracked('b1'), tracked('b2')])).toEqual([])
  })
  it('pedido misto: só reporta os que realmente precisam de frasco', () => {
    const items = [tracked(null, 'Naxos'), untracked(), tracked('b3', 'Guidance')]
    expect(unassignedBottleItems(items)).toEqual([tracked(null, 'Naxos')])
  })
})
