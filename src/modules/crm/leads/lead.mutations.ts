import { currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toLead, toLeadConversionResult } from './lead.helpers'
import {
  LEAD_COLUMNS,
  type Lead,
  type LeadConversionInput,
  type LeadConversionResult,
  type LeadInput,
  type LeadRow,
} from './lead.types'

function leadPayload(input: Partial<LeadInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.email !== undefined) patch.email = input.email || null
  if (input.phone !== undefined) patch.phone = input.phone || null
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp || null
  if (input.companyName !== undefined) patch.company_name = input.companyName || null
  if (input.companyId !== undefined) patch.company_id = input.companyId || null
  if (input.contactId !== undefined) patch.contact_id = input.contactId || null
  if (input.customerId !== undefined) patch.customer_id = input.customerId || null
  if (input.source !== undefined) patch.source = input.source || 'manual'
  if (input.sourceChannel !== undefined) patch.source_channel = input.sourceChannel || null
  if (input.sourceMedium !== undefined) patch.source_medium = input.sourceMedium || null
  if (input.sourceCampaign !== undefined) patch.source_campaign = input.sourceCampaign || null
  if (input.sourceExternalId !== undefined) patch.source_external_id = input.sourceExternalId || null
  if (input.attributionMetadata !== undefined) patch.attribution_metadata = input.attributionMetadata
  if (input.ownerUserId !== undefined) patch.owner_user_id = input.ownerUserId || null
  if (input.status !== undefined) patch.status = input.status
  if (input.temperature !== undefined) patch.temperature = input.temperature || null
  if (input.score !== undefined) patch.score = input.score
  if (input.metadata !== undefined) patch.metadata = input.metadata
  return patch
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('leads')
    .insert({ organization_id: organizationId, created_by: user.id, ...leadPayload(input) })
    .select(LEAD_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toLead(data as LeadRow)
}

export async function updateLead(leadId: string, input: Partial<LeadInput>): Promise<Lead> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('leads')
    .update(leadPayload(input))
    .eq('organization_id', organizationId)
    .eq('id', leadId)
    .select(LEAD_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toLead(data as LeadRow)
}

export async function convertLead(leadId: string, input: LeadConversionInput = {}): Promise<LeadConversionResult> {
  await currentOrganization()
  const { data, error } = await supabase!.rpc('convert_lead', {
    p_lead_id: leadId,
    p_create_customer: input.createCustomer ?? false,
    p_create_company: input.createCompany ?? false,
    p_create_contact: input.createContact ?? false,
    p_create_deal: input.createDeal ?? true,
    p_pipeline_id: input.pipelineId ?? null,
    p_stage_id: input.stageId ?? null,
    p_deal_title: input.dealTitle ?? null,
    p_deal_value: input.dealValue ?? 0,
  })
  if (error) throw new Error(error.message)
  return toLeadConversionResult(data as Record<string, unknown>)
}
