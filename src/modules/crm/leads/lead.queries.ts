import { authenticatedOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toLead } from './lead.helpers'
import { LEAD_COLUMNS, type Lead, type LeadRow } from './lead.types'

export async function fetchLeads(status?: string): Promise<Lead[]> {
  const { organizationId } = await authenticatedOrganization()
  let query = supabase!
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as LeadRow[]).map(toLead)
}

export async function fetchLead(leadId: string): Promise<Lead | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toLead(data as LeadRow) : null
}
