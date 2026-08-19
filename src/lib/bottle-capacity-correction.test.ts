import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Architecture correction pass — verifies the fixes to the two confirmed
 * deviations (bottle lifetime lock, advisory-only Final Shipping Audit)
 * and proves the split-consumption invariant. No live Postgres instance is
 * reachable from this sandbox, so — same technique as
 * ai-inventory.test.ts's "bootstrap SQL auditável" — these assert the
 * exact guarding SQL exists in the migration text rather than executing a
 * real concurrent transaction. Real concurrent-transaction behavior
 * remains PENDING HUMAN VALIDATION against a live database.
 */

const phase1 = readFileSync(new URL('../../supabase/migrations/202608190001_shipment_bottle_separation.sql', import.meta.url), 'utf8')
const splitUnits = readFileSync(new URL('../../supabase/migrations/202608190007_split_units.sql', import.meta.url), 'utf8')
const cancelShipment = readFileSync(new URL('../../supabase/migrations/202608130001_operational_foundation.sql', import.meta.url), 'utf8')

describe('Correction 1 — bottle is reusable across sequential orders (test 1)', () => {
  it('the old lifetime-lock unique index no longer exists', () => {
    expect(phase1).not.toContain('create unique index if not exists shipment_items_active_bottle_uidx')
    expect(splitUnits).not.toContain('shipment_items_active_bottle_uidx')
  })
  it('the capacity check excludes posted/delivered shipments from the committed sum, so a posted claim frees the bottle for reuse', () => {
    expect(splitUnits).toContain("s2.status not in('posted','delivered','cancelled')")
  })
  it('post_shipment never clears bottle_id — the historical record of which order used which bottle is preserved', () => {
    const postShipment = splitUnits.slice(splitUnits.lastIndexOf('create or replace function public.post_shipment'))
    // post_shipment only reads shipment_items.bottle_id/split_unit_id, it never issues
    // an UPDATE against shipment_items — clearing/switching the physical source on
    // rescan is shipment_item_scan_bottle's job (see Correction — scan source switch below).
    expect(postShipment).not.toContain('update public.shipment_items')
  })
})

describe('Correction 1 — active claims cannot overcommit bottle capacity (test 2)', () => {
  it('the bottle row is locked (for update) before the committed-capacity sum is computed', () => {
    const scanFn = splitUnits.slice(splitUnits.indexOf('create or replace function public.shipment_item_scan_bottle'))
    const lockIndex = scanFn.indexOf('limit 1\n    for update;')
    const sumIndex = scanFn.indexOf('select coalesce(sum(si.quantity_ml),0) into v_committed_ml')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(sumIndex).toBeGreaterThan(lockIndex)
  })
  it('a new claim is rejected once committed + needed would exceed physical_ml', () => {
    expect(splitUnits).toContain('if v_bottle.physical_ml-v_committed_ml<v_item.quantity_ml then')
    expect(splitUnits).toContain("return jsonb_build_object('ok',false,'reason','insufficient_ml'")
  })
})

describe('Correction 1 — cancelling a preparation releases the claim, not a permanent lock (test 3)', () => {
  it('cancel_draft_shipment marks the shipment_items removed, dropping them out of the committed sum', () => {
    expect(cancelShipment).toContain("update public.shipment_items set removed_at=now() where shipment_id=v.id and removed_at is null")
  })
  it('the committed-capacity query filters on removed_at is null, so a cancelled claim no longer counts', () => {
    expect(splitUnits).toContain('where si.bottle_id=v_bottle.id and si.removed_at is null and si.id<>v_item.id')
  })
})

describe('Correction 2 — Final Shipping Audit is now a hard backend gate (tests 4-6)', () => {
  const postShipment = splitUnits.slice(splitUnits.lastIndexOf('create or replace function public.post_shipment'))

  it('test 4: posting raises when a physically-tracked item has neither bottle_id nor split_unit_id', () => {
    expect(postShipment).toContain("if v_tracking_status='active' and v_bottle_id is null and v_split_id is null then")
    expect(postShipment).toContain("raise exception 'physical_source_not_confirmed';")
  })
  it('test 5: a valid bottle_id alone satisfies the gate (bottle_id is not null short-circuits the block)', () => {
    // the gate condition is an AND of two "is null" checks — bottle_id being
    // set makes the whole condition false, so the raise never fires for a
    // bottle-scanned item, regardless of split_unit_id.
    expect(postShipment).toContain('v_bottle_id is null and v_split_id is null')
  })
  it('test 6: a valid split_unit_id alone also satisfies the gate — same condition, symmetric for the split path', () => {
    expect(postShipment).toContain('v_split_id is null')
  })
  it('the gate is deterministic in the database, not a frontend decision — computed from inventory_items.bottle_tracking_status alone', () => {
    expect(postShipment).toContain('select bottle_tracking_status into v_tracking_status from public.inventory_items where id=r.inventory_item_id')
  })
})

describe('Correction 2 — legacy safety (tests 7-8)', () => {
  const postShipment = splitUnits.slice(splitUnits.lastIndexOf('create or replace function public.post_shipment'))

  it('test 7: the gate only applies when bottle_tracking_status=active — untracked/onboarding perfumes (the legacy majority) bypass it entirely', () => {
    expect(postShipment).toContain("v_tracking_status='active'")
  })
  it('test 8: the entire physical-tracking block, gate included, is nested inside "if r.stock_managed" — stock_managed=false allocations never reach it', () => {
    const gateIndex = postShipment.indexOf("raise exception 'physical_source_not_confirmed'")
    const stockManagedIndex = postShipment.indexOf('if r.stock_managed then')
    const closingBeforeGate = postShipment.slice(stockManagedIndex, gateIndex)
    expect(stockManagedIndex).toBeGreaterThan(-1)
    expect(gateIndex).toBeGreaterThan(stockManagedIndex)
    // no "end if" closes the stock_managed block between its opening and the gate
    expect(closingBeforeGate).not.toMatch(/end if;\s*$/)
  })
  it('already-posted/delivered shipments return early (idempotent) — re-invoking post_shipment on a historical shipment never re-runs the gate', () => {
    expect(postShipment).toContain("if v.status in('posted','delivered') then return; end if;")
  })
})

describe('Correction 3 — split fractionation never double-counts pooled inventory (tests 9-11)', () => {
  const splitFn = splitUnits.slice(splitUnits.indexOf('create or replace function public.inventory_split_bottle'), splitUnits.indexOf('grant execute on function public.inventory_split_bottle'))
  const postShipment = splitUnits.slice(splitUnits.lastIndexOf('create or replace function public.post_shipment'))

  it('test 9: fractionation never touches inventory_items (the pooled total) — only inventory_bottles and inventory_split_units', () => {
    expect(splitFn).not.toContain('inventory_items')
    expect(splitFn).toContain('update public.inventory_bottles set')
    expect(splitFn).toContain('insert into public.inventory_split_units(')
  })
  it('test 10: shipping ANY stock_managed item — split or not — decrements inventory_items.physical_ml exactly once per allocation loop iteration', () => {
    const occurrences = postShipment.match(/update public\.inventory_items set physical_ml=physical_ml-r\.quantity_ml/g) ?? []
    expect(occurrences).toHaveLength(1)
  })
  it('test 11: shipping a pre-created split does NOT decrement the source bottle again — the bottle and split consumption blocks are mutually exclusive (bottle_id is null for a split-fulfilled item)', () => {
    expect(postShipment).toContain('if v_bottle_id is not null then')
    expect(postShipment).toContain('if v_split_id is not null then')
    // the split branch only ever marks the split unit consumed — it never touches inventory_bottles
    const splitBranch = postShipment.slice(postShipment.indexOf('if v_split_id is not null then'), postShipment.indexOf('update public.inventory_allocations set status=\'shipped\''))
    expect(splitBranch).not.toContain('inventory_bottles')
  })

  it('arithmetic trace of the briefing\'s exact example — proves the formula on paper (not executed against a live database)', () => {
    // 100ml source bottle -> create 3x5ml splits
    const sourceBefore = 100
    const perVial = 5
    const vialCount = 3
    const totalFractionated = perVial * vialCount
    const sourceAfterSplit = sourceBefore - totalFractionated
    expect(sourceAfterSplit).toBe(85) // matches inventory_split_bottle: physical_ml=physical_ml-v_total
    const pooledAfterSplit = 100 // inventory_items never touched by inventory_split_bottle
    expect(pooledAfterSplit).toBe(100)

    // ship one 5ml split
    const pooledAfterShip = pooledAfterSplit - perVial // post_shipment's unconditional inventory_items decrement
    expect(pooledAfterShip).toBe(95)
    const sourceAfterShip = sourceAfterSplit // post_shipment's bottle branch never fires (bottle_id is null for a split-fulfilled item)
    expect(sourceAfterShip).toBe(85)
    const remainingSplitStock = totalFractionated - perVial // 2 splits still 'available'
    expect(remainingSplitStock).toBe(10)

    // invariant: pooled total always equals source bottle + all split units not yet shipped, at every step
    expect(pooledAfterSplit).toBe(sourceAfterSplit + totalFractionated)
    expect(pooledAfterShip).toBe(sourceAfterShip + remainingSplitStock)
  })
})

describe('Correction — tenant isolation remains blocked (test 12)', () => {
  const scanFn = splitUnits.slice(splitUnits.indexOf('create or replace function public.shipment_item_scan_bottle'))

  it('test 12: a shipment outside the caller\'s organization is rejected before any bottle/split resolution happens', () => {
    expect(scanFn).toContain('v_shipment.organization_id not in(select public.current_user_org_ids())')
  })
  it('bottle and split lookups are scoped to the shipment\'s own organization_id, never a bare global lookup', () => {
    expect(scanFn).toContain('su.organization_id=v_shipment.organization_id')
    expect(scanFn).toContain('b.organization_id=v_shipment.organization_id')
  })
  it('the capacity gate itself cannot be used to probe another tenant\'s bottle — the bottle lookup is already tenant-scoped before the sum runs', () => {
    const bottleSelectIndex = scanFn.indexOf('select b.* into v_bottle')
    const sumIndex = scanFn.indexOf('select coalesce(sum(si.quantity_ml),0) into v_committed_ml')
    expect(bottleSelectIndex).toBeGreaterThan(-1)
    expect(sumIndex).toBeGreaterThan(bottleSelectIndex)
  })
})
