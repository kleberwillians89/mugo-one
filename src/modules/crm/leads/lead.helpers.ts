import type { Lead, LeadConversionResult, LeadRow } from './lead.types'

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    companyName: row.company_name,
    companyId: row.company_id,
    contactId: row.contact_id,
    customerId: row.customer_id,
    source: row.source,
    sourceChannel: row.source_channel,
    sourceMedium: row.source_medium,
    sourceCampaign: row.source_campaign,
    sourceExternalId: row.source_external_id,
    attributionMetadata: row.attribution_metadata ?? {},
    ownerUserId: row.owner_user_id,
    status: row.status,
    temperature: row.temperature,
    score: row.score,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    convertedAt: row.converted_at,
    convertedCustomerId: row.converted_customer_id,
    convertedDealId: row.converted_deal_id,
  }
}

export function toLeadConversionResult(value: Record<string, unknown>): LeadConversionResult {
  return {
    leadId: String(value.lead_id),
    customerId: value.customer_id ? String(value.customer_id) : null,
    companyId: value.company_id ? String(value.company_id) : null,
    contactId: value.contact_id ? String(value.contact_id) : null,
    dealId: value.deal_id ? String(value.deal_id) : null,
    alreadyConverted: Boolean(value.already_converted),
  }
}
