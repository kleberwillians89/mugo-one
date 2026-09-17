import { supabase } from '../../lib/supabase'

export type OrganizationMembershipSummary = {
  organizationId: string
  role: string
  organizationName: string
}

/**
 * Lista, em ordem determinística (created_at asc — a organização mais
 * antiga do usuário primeiro), todas as organizações às quais o usuário
 * pertence. Nunca escolhe uma sozinha — isso é responsabilidade de
 * `resolveCurrentOrganization`.
 *
 * O hint `organizations!organization_members_organization_id_fkey` é
 * obrigatório: desde que `organization_member_permissions` passou a
 * referenciar organization_members(organization_id,user_id) e
 * organizations(organization_id) ao mesmo tempo, o PostgREST enxerga um
 * segundo caminho (many-to-many) entre organization_members e
 * organizations e recusa o embed por ambiguidade (PGRST201) — sem o
 * hint, TODO usuário fica preso em "Carregando..." ao entrar.
 */
export async function listMyOrganizations(userId: string): Promise<OrganizationMembershipSummary[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id,role,created_at,organizations!organization_members_organization_id_fkey(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const organization = row.organizations as { name?: string } | { name?: string }[] | null
    const organizationName = Array.isArray(organization) ? organization[0]?.name : organization?.name
    return {
      organizationId: row.organization_id as string,
      role: row.role as string,
      organizationName: organizationName ?? 'Organização',
    }
  })
}
