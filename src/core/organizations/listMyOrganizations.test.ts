import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regressão: sem o hint `!organization_members_organization_id_fkey`, o
 * PostgREST recusa o embed com PGRST201 ("more than one relationship")
 * porque `organization_member_permissions` também liga organization_members
 * a organizations (many-to-many). Sem esse hint, TODO usuário fica preso
 * em "Carregando..." ao entrar — bug real encontrado e corrigido durante a
 * validação da cadeia OrganizationProvider → PermissionsProvider → Sidebar.
 */
describe('listMyOrganizations — embed usa hint explícito de FK', () => {
  it('nunca volta a usar o embed ambíguo organizations(name)', () => {
    const source = readFileSync('src/core/organizations/listMyOrganizations.ts', 'utf8')
    expect(source).toContain('organizations!organization_members_organization_id_fkey(name)')
    expect(source).not.toContain(',organizations(name)')
  })
})
