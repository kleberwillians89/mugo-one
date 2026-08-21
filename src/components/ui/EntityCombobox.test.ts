import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nextComboboxIndex } from './entity-combobox-logic'

const component=readFileSync('src/components/ui/EntityCombobox.tsx','utf8')
const css=readFileSync('src/components/ui/EntityCombobox.css','utf8')
const records=readFileSync('src/lib/records.ts','utf8')

describe('EntityCombobox',()=>{
  it('supports arrow bounds',()=>{expect(nextComboboxIndex(-1,'ArrowDown',3)).toBe(0);expect(nextComboboxIndex(2,'ArrowDown',3)).toBe(2);expect(nextComboboxIndex(0,'ArrowUp',3)).toBe(0)})
  it('supports Enter, Escape, clear, loading and stale-response protection',()=>{expect(component).toContain("event.key==='Enter'");expect(component).toContain("event.key==='Escape'");expect(component).toContain('aria-label={`Limpar');expect(component).toContain('request.current===current');expect(component).toContain('Buscando…')})
  it('uses accessible combobox/listbox semantics',()=>{expect(component).toContain('role="combobox"');expect(component).toContain('role="listbox"');expect(component).toContain('role="option"');expect(component).toContain('aria-activedescendant')})
  it('is mobile safe and touch friendly',()=>{expect(css).toContain('@media(max-width:430px)');expect(css).toMatch(/min-height:52px/);expect(css).toContain('max-height:min(360px,48dvh)')})
})

describe('server-side entity queries',()=>{
  it('scopes eligible clients and limits the response',()=>{const query=records.slice(records.indexOf('export async function searchClients'),records.indexOf('export type InventorySummary'));expect(query).toContain(".eq('organization_id', organizationId)");expect(query).toContain(".is('deleted_at',null)");expect(query).toContain(".is('merged_into_id',null)");expect(query).toContain(".eq('status','active')");expect(query).toContain('.limit(12)')})
  it('searches perfumes by normalized prefix and returns IDs',()=>{const query=records.slice(records.indexOf('export async function searchPerfumes'),records.indexOf('export type InventorySummary'));expect(query).toContain("select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier')");expect(query).toContain(".eq('organization_id',organizationId)");expect(query).toContain(".gte('normalized_name',normalized)");expect(query).toContain('.limit(12)')})
})
