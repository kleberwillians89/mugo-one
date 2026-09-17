import { currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toDeal } from './deal.helpers'
import { DEAL_COLUMNS, type Deal, type DealInput, type DealRow } from './deal.types'

function dealPayload(input: Partial<DealInput>, includeStage: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (includeStage && input.pipelineId !== undefined) patch.pipeline_id = input.pipelineId
  if (includeStage && input.stageId !== undefined) patch.stage_id = input.stageId
  if (input.customerId !== undefined) patch.customer_id = input.customerId || null
  if (input.companyId !== undefined) patch.company_id = input.companyId || null
  if (input.contactId !== undefined) patch.contact_id = input.contactId || null
  if (input.leadId !== undefined) patch.lead_id = input.leadId || null
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.value !== undefined) patch.value = input.value
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase()
  if (input.ownerUserId !== undefined) patch.owner_user_id = input.ownerUserId || null
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.expectedCloseDate !== undefined) patch.expected_close_date = input.expectedCloseDate || null
  if (input.lossReason !== undefined) patch.loss_reason = input.lossReason || null
  if (input.source !== undefined) patch.source = input.source || 'manual'
  if (input.sourceChannel !== undefined) patch.source_channel = input.sourceChannel || null
  if (input.sourceMedium !== undefined) patch.source_medium = input.sourceMedium || null
  if (input.sourceCampaign !== undefined) patch.source_campaign = input.sourceCampaign || null
  if (input.sourceExternalId !== undefined) patch.source_external_id = input.sourceExternalId || null
  if (input.attributionMetadata !== undefined) patch.attribution_metadata = input.attributionMetadata
  if (input.metadata !== undefined) patch.metadata = input.metadata
  return patch
}

export async function createDeal(input: DealInput): Promise<Deal> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('deals')
    .insert({ organization_id: organizationId, created_by: user.id, ...dealPayload(input, true) })
    .select(DEAL_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toDeal(data as DealRow)
}

/** Stage é movimentado exclusivamente por moveDealStage(), que registra histórico. */
export async function updateDeal(dealId: string, input: Partial<DealInput>): Promise<Deal> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('deals')
    .update(dealPayload(input, false))
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .select(DEAL_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toDeal(data as DealRow)
}

export async function moveDealStage(dealId: string, destinationStageId: string): Promise<Deal> {
  await currentOrganization()
  const { data, error } = await supabase!.rpc('move_deal_stage', {
    p_deal_id: dealId,
    p_destination_stage_id: destinationStageId,
  })
  if (error) throw new Error(error.message)
  return toDeal(data as DealRow)
}
