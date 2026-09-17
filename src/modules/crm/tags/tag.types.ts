/** Tipos de entidade suportados hoje pelo sistema de tags — ver docs/CRM_DOMAIN_MODEL.md sobre por que a lista é restrita ao que já existe e é validável. */
export type TaggableEntityType = 'customer' | 'company' | 'contact' | 'lead' | 'deal'

export type Tag = {
  id: string
  organizationId: string
  name: string
  color: string | null
  createdAt: string
}

export type TagRow = {
  id: string
  organization_id: string
  name: string
  color: string | null
  created_at: string
}

export const TAG_COLUMNS = 'id,organization_id,name,color,created_at'

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }
}
