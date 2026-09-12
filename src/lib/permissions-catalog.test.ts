import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG } from './permissions'

/**
 * The frontend mirrors public.permissions as a TS constant
 * so the UI can render grouped checkboxes without a network round-trip.
 * This is the one place that duplication is checked against drift — if a
 * code is ever added/removed/renamed on one side without the other, this
 * fails loudly instead of silently showing a stale checkbox grid.
 */
const migrationsDirectory = new URL('../../supabase/migrations/', import.meta.url)

function sqlCodes(): string[] {
  const codes = new Set<string>()
  for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()) {
    const schema = readFileSync(new URL(file, migrationsDirectory), 'utf8')
    for (const statement of schema.matchAll(/insert into public\.permissions\s*\([^;]+;/gsi)) {
      for (const match of statement[0].matchAll(/\('([a-z_]+\.[a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*,\s*\d+\)/g)) {
        codes.add(match[1])
      }
    }
  }
  return [...codes]
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
