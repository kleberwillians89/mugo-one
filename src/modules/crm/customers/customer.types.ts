/**
 * CUSTOMER é o conceito de domínio genérico; `clients` continua sendo a
 * tabela física (ver docs/CRM_DOMAIN_MODEL.md — não renomeamos a tabela).
 * Este tipo mapeia as colunas de `clients` para o vocabulário genérico
 * pedido pela Sprint 2, sem esconder os campos legados que já funcionam
 * (cpf/cnpj continuam existindo e validados como sempre — `document` é
 * derivado, não substitui).
 */
export type Customer = {
  id: string
  organizationId: string
  name: string
  documentType: 'cpf' | 'cnpj' | null
  document: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
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
  source: string
  sourceChannel: string | null
  sourceCampaign: string | null
  sourceMedium: string | null
  sourceExternalId: string | null
  attributionMetadata: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ClientRow = {
  id: string
  organization_id: string
  name: string
  cpf: string | null
  cnpj: string | null
  email: string | null
  phone: string | null
  whatsapp_phone: string | null
  address_line: string | null
  address_number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  owner_user_id: string | null
  status: string
  source: string
  source_channel: string | null
  source_campaign: string | null
  source_medium: string | null
  source_external_id: string | null
  attribution_metadata: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export const CUSTOMER_COLUMNS =
  'id,organization_id,name,cpf,cnpj,email,phone,whatsapp_phone,address_line,address_number,complement,district,city,state,postal_code,country,owner_user_id,status,source,source_channel,source_campaign,source_medium,source_external_id,attribution_metadata,metadata,created_at,updated_at'

export function toCustomer(row: ClientRow): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    documentType: row.cnpj ? 'cnpj' : row.cpf ? 'cpf' : null,
    document: row.cnpj || row.cpf || null,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp_phone,
    addressLine: row.address_line,
    addressNumber: row.address_number,
    complement: row.complement,
    district: row.district,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country ?? 'BR',
    ownerUserId: row.owner_user_id,
    status: row.status,
    source: row.source,
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
