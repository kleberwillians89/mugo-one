/** Semântica completa em docs/CRM_DOMAIN_MODEL.md — companyId é o vínculo principal; customerId é compatibilidade opcional. */
export type Contact = {
  id: string
  organizationId: string
  companyId: string | null
  customerId: string | null
  name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  roleTitle: string | null
  isPrimary: boolean
  ownerUserId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ContactInput = {
  name: string
  companyId?: string | null
  customerId?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  roleTitle?: string | null
  isPrimary?: boolean
  ownerUserId?: string | null
}

export type ContactRow = {
  id: string
  organization_id: string
  company_id: string | null
  customer_id: string | null
  name: string
  email: string | null
  phone: string | null
  whatsapp_phone: string | null
  role_title: string | null
  is_primary: boolean
  owner_user_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export const CONTACT_COLUMNS =
  'id,organization_id,company_id,customer_id,name,email,phone,whatsapp_phone,role_title,is_primary,owner_user_id,metadata,created_at,updated_at'

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    companyId: row.company_id,
    customerId: row.customer_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp_phone,
    roleTitle: row.role_title,
    isPrimary: row.is_primary,
    ownerUserId: row.owner_user_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
