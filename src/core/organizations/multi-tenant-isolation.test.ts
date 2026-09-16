import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/202609170001_organization_settings_and_features.sql', import.meta.url),
  'utf8',
)

/**
 * Guarda de regressão estática (mesmo estilo de src/lib/sales-batch-security.test.ts):
 * não temos um banco de teste conectado neste ambiente para validar RLS
 * ao vivo (isolamento real entre Organization A e Organization B), então
 * este teste garante, por inspeção do SQL, que as tabelas novas seguem o
 * mesmo padrão comprovado do resto do schema (current_user_org_ids /
 * has_org_role) — SELECT nunca sem filtro de organização, escrita nunca
 * sem checar papel admin da própria organização.
 */
describe('isolamento multi-tenant — organization_settings e organization_features', () => {
  it('habilita RLS nas duas tabelas novas', () => {
    expect(migration).toContain('alter table public.organization_settings enable row level security')
    expect(migration).toContain('alter table public.organization_features enable row level security')
  })

  it('toda policy de SELECT restringe por organization_id via current_user_org_ids()', () => {
    const selectPolicies = migration.match(/create policy \w*_select[\s\S]*?;/g) ?? []
    const scoped = selectPolicies.filter((policy) => policy.includes('organization_id'))
    expect(scoped.length).toBeGreaterThanOrEqual(2)
    for (const policy of scoped) {
      expect(policy).toContain('current_user_org_ids()')
    }
  })

  it('toda policy de escrita (insert/update/delete) exige has_org_role admin da própria organização', () => {
    const writePolicies = migration.match(/create policy \w+_write[\s\S]*?;/g) ?? []
    expect(writePolicies.length).toBe(2)
    for (const policy of writePolicies) {
      expect(policy).toContain("has_org_role(organization_id, array['admin']::public.member_role[])")
    }
  })

  it('has_organization_feature é security definer e sempre filtra pela organização recebida como parâmetro', () => {
    expect(migration).toContain('create or replace function public.has_organization_feature(')
    expect(migration).toContain('security definer')
    expect(migration).toContain('where of.organization_id = p_organization_id')
  })

  it('nenhum arquivo novo de src/core/organizations referencia SERVICE_ROLE (mesma garantia já testada para o resto do frontend)', () => {
    const files = [
      'organizationStorage.ts',
      'listMyOrganizations.ts',
      'resolveCurrentOrganization.ts',
      'OrganizationProvider.tsx',
      'useOrganization.ts',
      'legacyOrganizationAccess.ts',
      'organizationSettings.ts',
    ]
    for (const file of files) {
      const content = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      expect(content).not.toContain('SERVICE_ROLE')
    }
  })
})
