import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the 42883 ("function public.inventory_apply(uuid,
 * numeric, text, text, text, unknown, unknown) does not exist") production
 * bug in the QR conference flow. No live Postgres instance is reachable
 * from this sandbox (same constraint as bottle-capacity-correction.test.ts
 * and inventory-apply-overload.test.ts), so these assert the exact
 * guarding SQL exists in the migration text rather than executing a real
 * conference call. Live confirmation against a real database remains
 * PENDING HUMAN VALIDATION (scripts/investigate-inventory-apply-overloads.sql
 * can be adapted, or a direct smoke test of the QR conference flow).
 */

const migration = readFileSync(new URL('../../supabase/migrations/202608190010_fix_confirm_conference_enum_cast.sql', import.meta.url), 'utf8')
const fn = migration.slice(migration.indexOf('create or replace function public.inventory_bottle_confirm_conference'))
const applyCall = fn.slice(fn.indexOf('v_movement := public.inventory_apply('), fn.indexOf(');', fn.indexOf('v_movement := public.inventory_apply(')) + 2)

describe('root cause — CASE expression must be cast to the enum explicitly', () => {
  it('the call site casts the CASE result to public.inventory_movement_type — the exact fix for the reported 42883', () => {
    expect(applyCall).toContain("(case when v_delta > 0 then 'positive_adjustment' else 'negative_adjustment' end)::public.inventory_movement_type")
  })
  it('this migration does NOT touch inventory_apply itself — no new signature, no new overload (briefing: "NÃO mexer em inventory_apply signature")', () => {
    expect(migration).not.toMatch(/create (or replace )?function public\.inventory_apply\(/)
    expect(migration).not.toMatch(/drop function.*inventory_apply/)
  })
  it('p_origin is preserved as \'qr_conference\' on the surviving 7-arg canonical call', () => {
    expect(applyCall).toContain("'qr_conference'")
  })
  it('p_sale_id (6th positional arg) is now explicitly typed — defense in depth against any future ambiguity, even though it was not the cause of this specific bug', () => {
    expect(applyCall).toContain('null::uuid')
  })
})

describe('B/C/D — positive_adjustment, negative_adjustment, and delta=0 are all covered', () => {
  it('B: estoque 0 → conferido 10 → delta +10 → positive_adjustment', () => {
    const before = 0, observed = 10
    const delta = observed - before
    expect(delta).toBe(10)
    expect(delta > 0 ? 'positive_adjustment' : 'negative_adjustment').toBe('positive_adjustment')
    expect(fn).toContain("when v_delta > 0 then 'positive_adjustment'")
  })
  it('C: estoque 10 → conferido 7 → delta -3 → negative_adjustment', () => {
    const before = 10, observed = 7
    const delta = observed - before
    expect(delta).toBe(-3)
    expect(delta > 0 ? 'positive_adjustment' : 'negative_adjustment').toBe('negative_adjustment')
    expect(fn).toContain("else 'negative_adjustment' end")
  })
  it('D: delta=0 nunca chama inventory_apply (que rejeita quantidade zero) — só registra a conferência via audit_logs direto, sem criar movimento indevido', () => {
    expect(fn).toContain('if v_delta <> 0 then')
    const noChangeBranch = fn.slice(fn.indexOf('if v_delta = 0 then'), fn.indexOf('end if;', fn.indexOf('if v_delta = 0 then')))
    expect(noChangeBranch).toContain("'inventory_bottle_conference_no_change'")
    expect(noChangeBranch).not.toContain('inventory_apply')
  })
})

describe('preserved invariants — same behavior, only the type-cast changed', () => {
  it('locks the bottle row before reading/mutating it', () => {
    expect(fn).toContain('select * into v_bottle from public.inventory_bottles where id = p_bottle_id for update;')
  })
  it('tenant isolation and role check unchanged', () => {
    expect(fn).toContain('v_bottle.organization_id not in (select public.current_user_org_ids())')
    expect(fn).toContain("array['admin','manager','operator']::public.member_role[]")
  })
  it('optimistic-lock guard against a stale conference unchanged', () => {
    expect(fn).toContain("raise exception 'stale_conference';")
  })
  it('still writes the inventory_bottle_conferences record and returns the same jsonb shape', () => {
    expect(fn).toContain('insert into public.inventory_bottle_conferences(')
    expect(fn).toContain("'conference_id', v_conference.id")
  })
  it('same public signature — CREATE OR REPLACE, not a new overload', () => {
    expect(migration).toContain('create or replace function public.inventory_bottle_confirm_conference(')
    expect(migration).toContain('p_bottle_id uuid,')
    expect(migration).toContain('p_observed_ml numeric,')
    expect(migration).toContain('p_apc_available boolean,')
    expect(migration).toContain('p_expected_updated_at timestamptz')
  })
  it('grant execute reapplied on the unchanged signature', () => {
    expect(migration).toContain('grant execute\n  on function public.inventory_bottle_confirm_conference(uuid, numeric, boolean, timestamptz)\n  to authenticated, service_role;')
  })
})

describe('audit of every other internal caller of inventory_apply — none of them share this bug', () => {
  const read = (relPath: string) => readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8')
  const bottleIdentity = read('supabase/migrations/202608180001_inventory_bottle_identity.sql')
  const triggerSignature = read('supabase/migrations/202607300016_inventory_trigger_signature.sql')
  const createItem = read('supabase/migrations/202608190008_inventory_create_item_idempotent.sql')

  it('inventory_bottle_add_new passes a bare literal (\'entry\') — never a CASE expression, stays "unknown"-typed and casts implicitly, no bug', () => {
    expect(bottleIdentity).toContain("perform public.inventory_apply(v_item.id,p_ml,'entry','Novo frasco físico identificado',null,null,'qr_conference');")
  })
  it('the orphaned inventory_sale_sync trigger function (no live trigger attaches it since 202608130001) also only ever used bare literals', () => {
    expect(triggerSignature).toContain("'cancellation_reversal'")
    expect(triggerSignature).toContain("'sale_out'")
    expect(triggerSignature).not.toMatch(/case when[^;]*inventory_apply/s)
  })
  it('the live inventory_create_item (202608190008) passes a bare literal (\'opening\') too', () => {
    expect(createItem).toContain("perform public.inventory_apply(v_item.id,p_opening_ml,'opening','Saldo inicial do estoque',p_notes,null);")
  })
})
