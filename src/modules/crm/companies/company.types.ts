export type Company = {
  id: string
  organizationId: string
  name: string
  legalName: string | null
  document: string | null
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  companySize: string | null
  addressLine: string | null
  addressNumber: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string
  ownerUserId: string | null
  status: string
  sourceChannel: string | null
  sourceCampaign: string | null
  sourceMedium: string | null
  sourceExternalId: string | null
  attributionMetadata: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CompanyInput = {
  name: string
  legalName?: string | null
  document?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  industry?: string | null
  companySize?: string | null
  addressLine?: string | null
  addressNumber?: string | null
  complement?: string | null
  district?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string
  ownerUserId?: string | null
  status?: string
  sourceChannel?: string | null
  sourceCampaign?: string | null
  sourceMedium?: string | null
  sourceExternalId?: string | null
}

export type CompanyRow = {
  id: string
  organization_id: string
  name: string
  legal_name: string | null
  document: string | null
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  company_size: string | null
  address_line: string | null
  address_number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string
  owner_user_id: string | null
  status: string
  source_channel: string | null
  source_campaign: string | null
  source_medium: string | null
  source_external_id: string | null
  attribution_metadata: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export const COMPANY_COLUMNS =
  'id,organization_id,name,legal_name,document,email,phone,website,industry,company_size,address_line,address_number,complement,district,city,state,postal_code,country,owner_user_id,status,source_channel,source_campaign,source_medium,source_external_id,attribution_metadata,metadata,created_at,updated_at'

export function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    legalName: row.legal_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    website: row.website,
    industry: row.industry,
    companySize: row.company_size,
    addressLine: row.address_line,
    addressNumber: row.address_number,
    complement: row.complement,
    district: row.district,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    ownerUserId: row.owner_user_id,
    status: row.status,
    sourceChannel: row.source_channel,
    sourceCampaign: row.source_campaign,
    sourceMedium: row.source_medium,
    sourceExternalId: row.source_external_id,
    attributionMetadata: row.attribution_metadata ?? {},
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
