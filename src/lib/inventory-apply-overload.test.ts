import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the 42725 ("function public.inventory_apply(...)
 * is not unique") smoke-test bug. No live Postgres instance is reachable
 * from this sandbox (same constraint as bottle-capacity-correction.test.ts
 * and ai-inventory.test.ts), so these assert the exact guarding SQL exists
 * in the migration text rather than executing a real ambiguous RPC call.
 * Live confirmation of "exactly one row" from pg_proc after applying this
 * migration remains PENDING HUMAN VALIDATION (scripts/investigate-
 * inventory-apply-overloads.sql — paste into the Supabase SQL editor).
 */

const migration = readFileSync(new URL('../../supabase/migrations/202608190009_inventory_apply_single_overload.sql', import.meta.url), 'utf8')
const records = readFileSync(new URL('./records.ts', import.meta.url), 'utf8')

describe('A — exactly one public inventory_apply overload remains', () => {
  it('drops the obsolete 6-arg signature by its EXACT type list, no CASCADE', () => {
    expect(migration).toMatch(/drop function if exists public\.inventory_apply\(\s*uuid,\s*numeric,\s*public\.inventory_movement_type,\s*text,\s*text,\s*uuid\s*\);/)
    expect(migration).not.toContain('cascade')
  })
  it('recreates the canonical 7-arg signature (p_origin optional, default null) via CREATE OR REPLACE — same signature it already had, a true replace not a new overload', () => {
    expect(migration).toContain('p_origin text default null')
    expect(migration).toMatch(/create or replace function public\.inventory_apply\(/)
  })
  it('the canonical signature is callable with exactly 6 named args (p_origin defaults) — the exact shape the frontend already sends', () => {
    expect(records).toContain("p_item_id:itemId,p_quantity_ml:quantity,p_type:movementType,p_reason:reason,p_notes:notes||null,p_sale_id:null,")
    expect(records).not.toContain('p_origin')
  })
  it('grant execute is reapplied on the canonical (surviving) signature explicitly', () => {
    expect(migration).toMatch(/grant execute\s*\n\s*on function public\.inventory_apply\(\s*\n\s*uuid, numeric, public\.inventory_movement_type, text, text, uuid, text\s*\n\s*\)\s*\n\s*to authenticated, service_role;/)
  })
})

describe('B/C/D — movement types accepted by the canonical function', () => {
  it('entry (Estoque "Entrada") is a confirming movement', () => {
    expect(migration).toContain("v_confirms := p_type in ('entry', 'positive_adjustment', 'negative_adjustment', 'administrative_correction');")
  })
  it('positive_adjustment and negative_adjustment (conferência física por QR/bipe) are both confirming movements — same list as above, checked explicitly', () => {
    const list = migration.match(/v_confirms := p_type in \(([^)]+)\);/)?.[1] ?? ''
    expect(list).toContain("'positive_adjustment'")
    expect(list).toContain("'negative_adjustment'")
  })
})

describe('E — p_notes=null / p_sale_id=null never causes ambiguity', () => {
  it('both remain optional with explicit defaults on the single surviving signature', () => {
    expect(migration).toContain('p_notes text default null')
    expect(migration).toContain('p_sale_id uuid default null')
  })
})

describe('F — bootstrap confirmation behavior restored (regression in the old 7-arg body, fixed here)', () => {
  it('clears bootstrap_pending_verification and reconciles review_required on a confirming movement, preserves them otherwise', () => {
    expect(migration).toContain('bootstrap_pending_verification = case when v_confirms then false else bootstrap_pending_verification end')
    expect(migration).toContain("reconciliation_status = case when v_confirms and reconciliation_status = 'review_required' then 'reconciled' else reconciliation_status end")
  })
})

describe('preserved invariants (briefing seção 2) — none weakened by the consolidation', () => {
  it('locks the inventory_items row before mutating it', () => {
    expect(migration).toContain('select * into v_item from public.inventory_items where id = p_item_id for update;')
  })
  it('rejects a movement that would take available_ml or physical_ml negative', () => {
    expect(migration).toContain("raise exception 'insufficient_available_inventory';")
    expect(migration).toContain("raise exception 'insufficient_physical_inventory';")
  })
  it('writes inventory_movements and audit_logs for every applied movement', () => {
    expect(migration).toContain('insert into public.inventory_movements(')
    expect(migration).toContain("insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)")
  })
})

describe('G/H — frontend sends a pure number, and the UI teaches the operator that (see ml-input.test.ts for the parsing unit tests)', () => {
  it('adjustInventory sends p_quantity_ml as the numeric `quantity` argument, never a formatted/unit-suffixed string', () => {
    expect(records).toMatch(/export async function adjustInventory\(itemId:string,quantity:number/)
    expect(records).toContain('p_quantity_ml:quantity')
  })
})
