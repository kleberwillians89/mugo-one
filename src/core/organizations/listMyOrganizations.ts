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
 */
export async function listMyOrganizations(userId: string): Promise<OrganizationMembershipSummary[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id,role,created_at,organizations(name)')
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
