import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG } from './permissions'

/**
 * The frontend mirrors public.permissions (202608190011) as a TS constant
 * so the UI can render grouped checkboxes without a network round-trip.
 * This is the one place that duplication is checked against drift — if a
 * code is ever added/removed/renamed on one side without the other, this
 * fails loudly instead of silently showing a stale checkbox grid.
 */
const schema = readFileSync(new URL('../../supabase/migrations/202608190011_team_permissions.sql', import.meta.url), 'utf8')

function sqlCodes(): string[] {
  const block = schema.slice(schema.indexOf("insert into public.permissions"), schema.indexOf(';', schema.indexOf('insert into public.permissions')))
  const matches = block.matchAll(/\('([a-z_]+\.[a-z_]+)','([a-z_]+)','([^']+)',\d+\)/g)
  return Array.from(matches, (match) => match[1])
}

describe('catálogo de permissões — TS nunca diverge do SQL', () => {
  it('mesma quantidade de códigos dos dois lados', () => {
    expect(PERMISSION_CATALOG.length).toBe(sqlCodes().length)
  })
  it('mesmo conjunto exato de códigos', () => {
    expect(new Set(PERMISSION_CATALOG.map((entry) => entry.code))).toEqual(new Set(sqlCodes()))
  })
  it('nenhum código duplicado em nenhum dos dois lados', () => {
    const codes = PERMISSION_CATALOG.map((entry) => entry.code)
    expect(new Set(codes).size).toBe(codes.length)
    const raw = sqlCodes()
    expect(new Set(raw).size).toBe(raw.length)
  })
})
