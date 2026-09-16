export type CustomFieldEntityType = 'customer' | 'company' | 'contact'

export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'email'
  | 'phone'
  | 'url'

export type CustomField = {
  id: string
  organizationId: string
  entityType: CustomFieldEntityType
  name: string
  key: string
  fieldType: CustomFieldType
  options: unknown[]
  required: boolean
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type CustomFieldRow = {
  id: string
  organization_id: string
  entity_type: CustomFieldEntityType
  name: string
  key: string
  field_type: CustomFieldType
  options: unknown[] | null
  required: boolean
  position: number
  active: boolean
  created_at: string
  updated_at: string
}

export const CUSTOM_FIELD_COLUMNS =
  'id,organization_id,entity_type,name,key,field_type,options,required,position,active,created_at,updated_at'

export function toCustomField(row: CustomFieldRow): CustomField {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    name: row.name,
    key: row.key,
    fieldType: row.field_type,
    options: row.options ?? [],
    required: row.required,
    position: row.position,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
