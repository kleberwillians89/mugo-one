export type DealPriority = 'low' | 'normal' | 'high' | 'urgent'

export type Deal = {
  id: string
  organizationId: string
  pipelineId: string
  stageId: string
  customerId: string | null
  companyId: string | null
  contactId: string | null
  leadId: string | null
  title: string
  value: number
  currency: string
  ownerUserId: string | null
  priority: DealPriority
  expectedCloseDate: string | null
  wonAt: string | null
  lostAt: string | null
  lossReason: string | null
  source: string
  sourceChannel: string | null
  sourceMedium: string | null
  sourceCampaign: string | null
  sourceExternalId: string | null
  attributionMetadata: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type DealInput = {
  pipelineId: string
  stageId: string
  customerId?: string | null
  companyId?: string | null
  contactId?: string | null
  leadId?: string | null
  title: string
  value?: number
  currency?: string
  ownerUserId?: string | null
  priority?: DealPriority
  expectedCloseDate?: string | null
  lossReason?: string | null
  source?: string
  sourceChannel?: string | null
  sourceMedium?: string | null
  sourceCampaign?: string | null
  sourceExternalId?: string | null
  attributionMetadata?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type DealRow = {
  id: string
  organization_id: string
  pipeline_id: string
  stage_id: string
  customer_id: string | null
  company_id: string | null
  contact_id: string | null
  lead_id: string | null
  title: string
  value: number
  currency: string
  owner_user_id: string | null
  priority: DealPriority
  expected_close_date: string | null
  won_at: string | null
  lost_at: string | null
  loss_reason: string | null
  source: string
  source_channel: string | null
  source_medium: string | null
  source_campaign: string | null
  source_external_id: string | null
  attribution_metadata: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type DealStageHistory = {
  id: string
  dealId: string
  fromStageId: string
  toStageId: string
  movedBy: string | null
  movedAt: string
}

export const DEAL_COLUMNS =
  'id,organization_id,pipeline_id,stage_id,customer_id,company_id,contact_id,lead_id,title,value,currency,owner_user_id,priority,expected_close_date,won_at,lost_at,loss_reason,source,source_channel,source_medium,source_campaign,source_external_id,attribution_metadata,metadata,created_at,updated_at'
