import { getStoredOrganizationId, setStoredOrganizationId } from './organizationStorage'
import { listMyOrganizations, type OrganizationMembershipSummary } from './listMyOrganizations'

export type ResolvedOrganization = OrganizationMembershipSummary & {
  /**
   * 'stored': havia uma preferência salva válida.
   * 'single': o usuário só pertence a uma organização — escolha inequívoca.
   * 'first-fallback': 2+ organizações, nenhuma preferência salva — default
   *   determinístico (primeira por created_at) até uma escolha explícita.
   */
  resolvedBy: 'stored' | 'single' | 'first-fallback'
}

/**
 * Resolve a organização atual do usuário sem nunca escolher "a primeira
 * que aparecer" de forma silenciosa e não determinística, como o legado
 * fazia (`organization_members...limit(1).single()` sem ORDER BY).
 *
 * Preferência explícita persistida sempre vence; com uma única
 * organização a escolha é inequívoca; só quando há 2+ organizações e
 * nenhuma preferência salva é que caímos num default determinístico — e
 * isso fica marcado em `resolvedBy: 'first-fallback'` e registrado via
 * console.warn, para nunca mais ser um comportamento opaco.
 */
export async function resolveCurrentOrganization(userId: string): Promise<ResolvedOrganization> {
  const memberships = await listMyOrganizations(userId)
  if (memberships.length === 0) {
    throw new Error('Usuário sem organização vinculada.')
  }

  const stored = getStoredOrganizationId(userId)
  const storedMatch = stored ? memberships.find((membership) => membership.organizationId === stored) : undefined
  if (storedMatch) {
    return { ...storedMatch, resolvedBy: 'stored' }
  }

  if (memberships.length === 1) {
    setStoredOrganizationId(userId, memberships[0].organizationId)
    return { ...memberships[0], resolvedBy: 'single' }
  }

  const first = memberships[0]
  console.warn(
    `[organizations] usuário ${userId} pertence a ${memberships.length} organizações e não tinha preferência salva; ` +
      `selecionando "${first.organizationName}" (${first.organizationId}) como default até uma escolha explícita.`,
  )
  setStoredOrganizationId(userId, first.organizationId)
  return { ...first, resolvedBy: 'first-fallback' }
}

/** Usado pelo futuro seletor de organização (ainda não construído nesta sprint). */
export function setCurrentOrganizationOverride(userId: string, organizationId: string): void {
  setStoredOrganizationId(userId, organizationId)
}
