import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization, currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import {
  CUSTOM_FIELD_COLUMNS,
  toCustomField,
  type CustomField,
  type CustomFieldEntityType,
  type CustomFieldRow,
  type CustomFieldType,
} from './customField.types'

export async function fetchCustomFields(entityType: CustomFieldEntityType): Promise<CustomField[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('custom_fields')
    .select(CUSTOM_FIELD_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType)
    .eq('active', true)
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as CustomFieldRow[]).map(toCustomField)
}

export async function createCustomField(input: {
  entityType: CustomFieldEntityType
  name: string
  key: string
  fieldType: CustomFieldType
  options?: unknown[]
  required?: boolean
  position?: number
}): Promise<CustomField> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('custom_fields')
    .insert({
      organization_id: organizationId,
      entity_type: input.entityType,
      name: input.name.trim(),
      key: input.key.trim().toLowerCase(),
      field_type: input.fieldType,
      options: input.options ?? [],
      required: input.required ?? false,
      position: input.position ?? 0,
    })
    .select(CUSTOM_FIELD_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toCustomField(data as CustomFieldRow)
}

export type CustomFieldValue = {
  id: string
  customFieldId: string
  entityType: CustomFieldEntityType
  entityId: string
  value: unknown
}

export async function fetchCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string,
): Promise<CustomFieldValue[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('custom_field_values')
    .select('id,custom_field_id,entity_type,entity_id,value')
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    customFieldId: row.custom_field_id as string,
    entityType: row.entity_type as CustomFieldEntityType,
    entityId: row.entity_id as string,
    value: row.value,
  }))
}

/**
 * Upsert por (custom_field_id, entity_id) — a unicidade já existe no
 * banco (constraint custom_field_values_custom_field_id_entity_id_key).
 * A validação de que custom_field/entidade pertencem a esta organização
 * é feita pelo trigger custom_field_values_validate, não aqui.
 */
export async function setCustomFieldValue(
  customFieldId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
  value: unknown,
): Promise<CustomFieldValue> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('custom_field_values')
    .upsert(
      {
        organization_id: organizationId,
        custom_field_id: customFieldId,
        entity_type: entityType,
        entity_id: entityId,
        value,
      },
      { onConflict: 'custom_field_id,entity_id' },
    )
    .select('id,custom_field_id,entity_type,entity_id,value')
    .single()
  if (error) throw new Error(error.message)
  return {
    id: data.id as string,
    customFieldId: data.custom_field_id as string,
    entityType: data.entity_type as CustomFieldEntityType,
    entityId: data.entity_id as string,
    value: data.value,
  }
}
