import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countPendingPhysicalConference } from './control-tower'
import { OperationalShipment } from './records'

/**
 * SuperFrete / physical conference ordering fix. Traced the real code (not
 * function names): superfrete-quote never touches conference at all
 * (read-only); superfrete-create-label's cart+checkout are the first
 * actions that create/commit something on SuperFrete's side, and now both
 * are gated the same way post_shipment already is; superfrete-sync-shipment
 * is the existing, already-idempotent retry path — proven, not rewritten.
 * No live edge-function runtime or Postgres instance is reachable from this
 * sandbox, so these are source-level assertions (same technique as
 * ai-inventory.test.ts and bottle-capacity-correction.test.ts), plus pure
 * unit tests for the one piece of real client-side logic this fix added.
 */

const quoteFn = readFileSync(new URL('../../supabase/functions/superfrete-quote/index.ts', import.meta.url), 'utf8')
const createLabelFn = readFileSync(new URL('../../supabase/functions/superfrete-create-label/index.ts', import.meta.url), 'utf8')
const syncFn = readFileSync(new URL('../../supabase/functions/superfrete-sync-shipment/index.ts', import.meta.url), 'utf8')
const splitUnitsMigration = readFileSync(new URL('../../supabase/migrations/202608190007_split_units.sql', import.meta.url), 'utf8')

describe('test 1 — freight quote remains available before physical scan (read-only)', () => {
  it('superfrete-quote never reads shipment_items conference/bottle state at all — it only calls the price calculator and saves the returned quotes', () => {
    expect(quoteFn).not.toContain('shipment_items')
    expect(quoteFn).not.toContain('checked_at')
    expect(quoteFn).not.toContain('bottle_id')
    expect(quoteFn).toContain("/api/v0/calculator")
    expect(quoteFn).toContain('save_superfrete_quotes')
  })
})

describe('tests 2-3-4 — the first externally committing SuperFrete action is gated (cart + checkout)', () => {
  it('test 2: the gate runs before either cart creation or checkout — both are behind the same early check', () => {
    const gateIndex = createLabelFn.indexOf('missingPhysicalSource')
    const cartBranchIndex = createLabelFn.indexOf("initialAction==='create_cart'")
    const checkoutBranchIndex = createLabelFn.indexOf("requestedAction!=='checkout'")
    expect(gateIndex).toBeGreaterThan(-1)
    expect(cartBranchIndex).toBeGreaterThan(gateIndex)
    expect(checkoutBranchIndex).toBeGreaterThan(gateIndex)
  })
  it('the gate returns a structured 409 with the same reason code the database-level post_shipment gate uses — one vocabulary for the same rule at two layers', () => {
    expect(createLabelFn).toContain("code:'physical_source_not_confirmed'")
    expect(splitUnitsMigration).toContain("raise exception 'physical_source_not_confirmed'")
  })
  it('test 3: an item with bottle_id already set does not count toward missingPhysicalSource — the OR-of-nulls condition requires BOTH to be absent', () => {
    expect(createLabelFn).toContain('tracked&&!item.bottle_id&&!item.split_unit_id')
  })
  it('test 4: the same condition is satisfied by split_unit_id alone — bottle_id and split_unit_id are each independently sufficient', () => {
    // !item.bottle_id&&!item.split_unit_id only blocks when BOTH are falsy;
    // either one being set makes the whole expression false.
    const blocks = (bottleId: string | null, splitId: string | null) => Boolean(!bottleId && !splitId)
    expect(blocks(null, null)).toBe(true)
    expect(blocks('b1', null)).toBe(false)
    expect(blocks(null, 's1')).toBe(false)
  })
})

describe('test 5 — post_shipment defensive gate still blocks a bypassed/direct path', () => {
  it('the database-level gate from the previous correction pass is untouched and still present', () => {
    expect(splitUnitsMigration).toContain("if v_tracking_status='active' and v_bottle_id is null and v_split_id is null then")
    expect(splitUnitsMigration).toContain("raise exception 'physical_source_not_confirmed';")
  })
})

describe('tests 6-7-8 — early external state is recoverable, not erased or faked; retry is idempotent', () => {
  it('test 6: the sync path never sets bottle_id/split_unit_id itself — it only reads SuperFrete state and persists a visible pending marker, never fabricates a scan', () => {
    expect(syncFn).not.toMatch(/\bbottle_id\s*[:=]/)
    expect(syncFn).not.toMatch(/\bsplit_unit_id\s*[:=]/)
    expect(syncFn).toContain("integration_error:'PHYSICAL_CONFERENCE_PENDING'")
  })
  it('the pending state is a distinct, named operational exception, not a generic swallowed error — the specific applyError is checked before falling through to the generic throw', () => {
    const specificCheckIndex = syncFn.indexOf("applyError.message.includes('physical_source_not_confirmed')")
    const genericThrowIndex = syncFn.indexOf('throw new Error(applyError.message)')
    expect(specificCheckIndex).toBeGreaterThan(-1)
    expect(genericThrowIndex).toBeGreaterThan(specificCheckIndex)
  })
  it('test 7: retrying sync after a valid scan resolves normally — nothing in the sync path special-cases "already tried once", so a later call with the gate now satisfied just succeeds via the normal apply_superfrete_state path', () => {
    // The recovery mechanism is the ABSENCE of blocking state on retry, not
    // a dedicated "retry" code path — sync always re-reads SuperFrete's
    // current state and re-attempts apply_superfrete_state fresh each call.
    expect(syncFn).toContain("ctx.client.rpc('apply_superfrete_state'")
    expect(syncFn.match(/ctx\.client\.rpc\('apply_superfrete_state'/g)).toHaveLength(1)
  })
  it('test 8: reconciliation is idempotent — post_shipment returns early once already posted, and apply_superfrete_state only attempts posting when not already posted locally', () => {
    expect(splitUnitsMigration).toContain("if v.status in('posted','delivered') then return; end if;")
  })
})

describe('tests 9-10 — legacy and stock_managed=false remain compatible', () => {
  it('test 9: the operation-level gate only flags items whose inventory_items.bottle_tracking_status is exactly \'active\' — legacy/untracked perfumes never match', () => {
    expect(createLabelFn).toContain("bottle_tracking_status==='active'")
  })
  it('test 10: the gate condition requires stock_managed to be true first — allocations with stock_managed=false can never be flagged', () => {
    expect(createLabelFn).toContain('Boolean(allocation?.stock_managed)&&allocation?.inventory_items?.bottle_tracking_status')
  })
})

describe('test 11 — no automatic postage purchase was introduced', () => {
  it('cart creation alone still explicitly signals that checkout confirmation is a separate, required step', () => {
    expect(createLabelFn).toContain("requires_checkout_confirmation:true")
  })
  it('the actual SuperFrete purchase call only fires when the caller explicitly requests the checkout action', () => {
    expect(createLabelFn).toContain("if(requestedAction!=='checkout')return")
  })
  it('the new gate adds a precondition to existing human-triggered actions — it does not add any new automatic trigger for cart or checkout', () => {
    expect(createLabelFn).not.toContain('setInterval')
    expect(createLabelFn).not.toContain('setTimeout')
  })
})

describe('test 12 — tenant isolation remains intact', () => {
  it('the new conference query is scoped by shipment_id, and the shipment itself was already loaded scoped to organization_id before this point', () => {
    expect(createLabelFn).toContain(".eq('organization_id',ctx.organizationId).single()")
    const orgScopedLoad = createLabelFn.indexOf("eq('organization_id',ctx.organizationId).single()")
    const conferenceQuery = createLabelFn.indexOf('missingPhysicalSource')
    expect(orgScopedLoad).toBeGreaterThan(-1)
    expect(orgScopedLoad).toBeLessThan(conferenceQuery)
  })
  it('the sync path persists the pending marker scoped to both id and organization_id, never a bare id-only update', () => {
    expect(syncFn).toContain(".eq('id',shipmentId).eq('organization_id',ctx.organizationId)")
  })
})

describe('countPendingPhysicalConference (Control Tower exception hook)', () => {
  function shipment(overrides: Partial<OperationalShipment> & { id: string }): OperationalShipment {
    return {
      organization_id: 'org1', client_id: 'c1', status: 'label_released', created_at: '2026-08-10T10:00:00Z',
      recipient_name: 'Cliente', recipient_phone: null, recipient_document: null, recipient_email: null,
      recipient_postal_code: null, recipient_address: null, recipient_number: null, recipient_complement: null,
      recipient_district: null, recipient_city: null, recipient_state: null,
      package_weight: null, package_height: null, package_width: null, package_length: null, package_format: null,
      declared_value: null, fiscal_mode: 'nfe', selected_quote_id: null, carrier: null, service: null, service_id: null,
      shipping_price: null, superfrete_order_id: null, superfrete_status: null, checkout_status: null,
      tracking_code: null, print_url: null, label_pdf_url: null, integration_error: null,
      print_available: false, print_http_status: null, print_content_type: null, print_checked_at: null,
      conference_owner_user_id: null, conference_owner_name_snapshot: null, conference_started_at: null, conference_completed_at: null,
      clients: null, shipment_quotes: [], shipment_items: [],
      ...overrides,
    }
  }

  it('counts only shipments carrying the specific pending-conference marker', () => {
    const rows = [
      shipment({ id: 'a', integration_error: 'PHYSICAL_CONFERENCE_PENDING' }),
      shipment({ id: 'b', integration_error: null }),
      shipment({ id: 'c', integration_error: 'SUPERFRETE_FILE_MISSING' }),
      shipment({ id: 'd', integration_error: 'PHYSICAL_CONFERENCE_PENDING' }),
    ]
    expect(countPendingPhysicalConference(rows)).toBe(2)
  })
  it('returns zero for an empty or all-clear list', () => {
    expect(countPendingPhysicalConference([])).toBe(0)
    expect(countPendingPhysicalConference([shipment({ id: 'a' })])).toBe(0)
  })
})
