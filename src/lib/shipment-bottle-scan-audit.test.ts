import { describe, expect, it } from 'vitest'
import { unassignedBottleItems } from './shipment-bottle-scan'

const tracked = (bottleId: string | null, perfume = 'Naxos', splitUnitId: string | null = null) => ({
  bottle_id: bottleId,
  split_unit_id: splitUnitId,
  sales: { perfume_name_raw: perfume },
  inventory_allocations: { stock_managed: true, inventory_items: { bottle_tracking_status: 'active' } },
})
const untracked = (bottleId: string | null = null) => ({
  bottle_id: bottleId,
  split_unit_id: null,
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
  it('Priority 0B: item resolvido por SPLIT (sem bottle_id) nunca é reportado como pendente', () => {
    const bySplit = tracked(null, 'Naxos', 'split-1')
    expect(unassignedBottleItems([bySplit])).toEqual([])
  })
  it('Priority 0B: pedido misto de frasco fonte + split — só o que não tem nenhum dos dois fica pendente', () => {
    const items = [tracked(null, 'Naxos'), tracked('b1'), tracked(null, 'Guidance', 'split-1')]
    expect(unassignedBottleItems(items)).toEqual([tracked(null, 'Naxos')])
  })
})
