import { authenticatedOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toDeal, toDealStageHistory } from './deal.helpers'
import { DEAL_COLUMNS, type Deal, type DealRow, type DealStageHistory } from './deal.types'

export async function fetchDeals(pipelineId?: string): Promise<Deal[]> {
  const { organizationId } = await authenticatedOrganization()
  let query = supabase!
    .from('deals')
    .select(DEAL_COLUMNS)
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
  if (pipelineId) query = query.eq('pipeline_id', pipelineId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as DealRow[]).map(toDeal)
}

export async function fetchDeal(dealId: string): Promise<Deal | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('deals')
    .select(DEAL_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toDeal(data as DealRow) : null
}

export async function fetchDealStageHistory(dealId: string): Promise<DealStageHistory[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('deal_stage_history')
    .select('id,deal_id,from_stage_id,to_stage_id,moved_by,moved_at')
    .eq('organization_id', organizationId)
    .eq('deal_id', dealId)
    .order('moved_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toDealStageHistory(row as Record<string, unknown>))
}
