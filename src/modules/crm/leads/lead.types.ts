export type Lead = {
  id: string
  organizationId: string
  name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  companyName: string | null
  companyId: string | null
  contactId: string | null
  customerId: string | null
  source: string
  sourceChannel: string | null
  sourceMedium: string | null
  sourceCampaign: string | null
  sourceExternalId: string | null
  attributionMetadata: Record<string, unknown>
  ownerUserId: string | null
  status: string
  temperature: string | null
  score: number | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  convertedAt: string | null
  convertedCustomerId: string | null
  convertedDealId: string | null
}

export type LeadInput = {
  name: string
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  companyName?: string | null
  companyId?: string | null
  contactId?: string | null
  customerId?: string | null
  source?: string
  sourceChannel?: string | null
  sourceMedium?: string | null
  sourceCampaign?: string | null
  sourceExternalId?: string | null
  attributionMetadata?: Record<string, unknown>
  ownerUserId?: string | null
  status?: string
  temperature?: string | null
  score?: number | null
  metadata?: Record<string, unknown>
}

export type LeadRow = {
  id: string
  organization_id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  company_name: string | null
  company_id: string | null
  contact_id: string | null
  customer_id: string | null
  source: string
  source_channel: string | null
  source_medium: string | null
  source_campaign: string | null
  source_external_id: string | null
  attribution_metadata: Record<string, unknown> | null
  owner_user_id: string | null
  status: string
  temperature: string | null
  score: number | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  converted_at: string | null
  converted_customer_id: string | null
  converted_deal_id: string | null
}

export type LeadConversionInput = {
  createCustomer?: boolean
  createCompany?: boolean
  createContact?: boolean
  createDeal?: boolean
  pipelineId?: string | null
  stageId?: string | null
  dealTitle?: string | null
  dealValue?: number
}

export type LeadConversionResult = {
  leadId: string
  customerId: string | null
  companyId: string | null
  contactId: string | null
  dealId: string | null
  alreadyConverted: boolean
}

export const LEAD_COLUMNS =
  'id,organization_id,name,email,phone,whatsapp,company_name,company_id,contact_id,customer_id,source,source_channel,source_medium,source_campaign,source_external_id,attribution_metadata,owner_user_id,status,temperature,score,metadata,created_at,updated_at,converted_at,converted_customer_id,converted_deal_id'
