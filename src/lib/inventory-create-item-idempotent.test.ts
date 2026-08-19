import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the production 23505 (duplicate key on
 * inventory_items_organization_id_perfume_id_key): public.inventory_create_item
 * used to INSERT with zero duplicate protection, and the "Cadastrar perfume"
 * form let a user pick a perfume that already had an inventory_item. No live
 * Postgres instance is reachable from this sandbox (same constraint as
 * ai-inventory.test.ts / bottle-capacity-correction.test.ts), so these assert
 * the exact guarding SQL/source text rather than executing a real insert.
 * Concurrent-transaction behavior remains PENDING HUMAN VALIDATION against a
 * live database.
 */

const migration = readFileSync(new URL('../../supabase/migrations/202608190008_inventory_create_item_idempotent.sql', import.meta.url), 'utf8')
const fn = migration.slice(migration.indexOf('create or replace function public.inventory_create_item'))
const reuseBranch = fn.slice(fn.indexOf('if v_item.id is null then'), fn.indexOf('if p_opening_ml>0 then'))

const dashboard = readFileSync(new URL('../pages/Dashboard.tsx', import.meta.url), 'utf8')
const controlTowerPage = readFileSync(new URL('../pages/ControlTowerPage.tsx', import.meta.url), 'utf8')

describe('inventory_create_item is idempotent (test A/B — canonical 1 org+perfume=1 pooled row)', () => {
  it('A: a perfume with no inventory_item still creates one, with opening_ml applied', () => {
    expect(fn).toContain('insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,minimum_ml,notes,created_by)')
    expect(fn).toContain('on conflict (organization_id,perfume_id) do nothing')
    expect(fn).toContain("if p_opening_ml>0 then\n    perform public.inventory_apply(v_item.id,p_opening_ml,'opening'")
  })
  it('B: a perfume that already has an inventory_item reuses it — no raw 23505 reaches the caller', () => {
    expect(fn).toContain('if v_item.id is null then')
    expect(reuseBranch).toContain('select * into v_item from public.inventory_items')
    expect(reuseBranch).toContain('where organization_id=p_organization_id and perfume_id=p_perfume_id')
    expect(reuseBranch).toContain('return v_item;')
  })
})

describe('inventory_create_item under concurrency (test C)', () => {
  it('two concurrent calls for the same (organization_id, perfume_id) can only ever produce one row — Postgres serializes on the unique index via ON CONFLICT DO NOTHING, and the loser re-selects the winner\'s row', () => {
    expect(fn).toContain('on conflict (organization_id,perfume_id) do nothing')
    expect(fn).toContain('returning * into v_item')
    // the loser branch always re-selects by the same (org, perfume) key the winner inserted under —
    // both calls resolve to the identical row identity, never a second row.
    expect(reuseBranch).toContain('organization_id=p_organization_id and perfume_id=p_perfume_id')
  })
})

describe('inventory_create_item never overwrites existing operational stock (test D)', () => {
  it('the reuse branch only reads and returns the existing row — no UPDATE/SET touches it', () => {
    expect(reuseBranch).not.toMatch(/update\s+public\.inventory_items/)
    expect(reuseBranch).not.toContain('set ')
  })
  it('the unique constraint itself is untouched — this fix never removes or weakens it', () => {
    expect(migration).not.toContain('drop constraint')
    expect(migration).not.toContain('drop index')
  })
})

describe('page load never creates inventory (tests E/F)', () => {
  const creators = ['createInventoryItem', 'inventory_create_item', 'bootstrapAiBatchInventory', 'bootstrap_ai_batch_inventory']

  it('E: Visão Geral (Dashboard) only reads — it never calls an inventory-creating function on mount', () => {
    for (const name of creators) expect(dashboard).not.toContain(name)
  })
  it('F: Torre de Controle only reads — it never calls an inventory-creating function on mount', () => {
    for (const name of creators) expect(controlTowerPage).not.toContain(name)
  })
  it('F: Torre de Controle never gets stuck on "Carregando torre de controle…" forever — the loading gate no longer depends on summary being set', () => {
    // Previously: `loading || !summary ? <Carregando/> : <grid/>` — a rejected
    // fetchControlTowerSummary() left summary permanently null, so the page
    // stayed on the loading text even after the fetch settled and the error
    // banner was already showing. The gate must depend on `loading` alone.
    expect(controlTowerPage).not.toContain('loading || !summary')
    expect(controlTowerPage).toContain('.finally(() => setLoading(false))')
    expect(controlTowerPage).toContain('{loading ? <div className="empty card"><h3>Carregando torre de controle…</h3></div> :')
  })
})
