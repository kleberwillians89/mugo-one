import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization, currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { normalizeClient } from '../../../lib/importer'
import { TAG_COLUMNS, toTag, type Tag, type TagRow, type TaggableEntityType } from './tag.types'

export async function fetchTags(): Promise<Tag[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('tags')
    .select(TAG_COLUMNS)
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as TagRow[]).map(toTag)
}

export async function createTag(name: string, color?: string | null): Promise<Tag> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('tags')
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      normalized_name: normalizeClient(name),
      color: color || null,
      created_by: user.id,
    })
    .select(TAG_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toTag(data as TagRow)
}

export type EntityTag = {
  id: string
  tagId: string
  entityType: TaggableEntityType
  entityId: string
  createdAt: string
}

/**
 * A checagem de tenant (tag e entidade pertencem à mesma organização)
 * é feita no banco por trigger (entity_tags_validate_tag_tenant /
 * entity_tags_validate_tenant_ownership) — uma tentativa de taguear uma
 * entidade de outra organização é rejeitada com exceção pelo Postgres,
 * não silenciosamente ignorada.
 */
export async function tagEntity(entityType: TaggableEntityType, entityId: string, tagId: string): Promise<EntityTag> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('entity_tags')
    .insert({
      organization_id: organizationId,
      entity_type: entityType,
      entity_id: entityId,
      tag_id: tagId,
      created_by: user.id,
    })
    .select('id,tag_id,entity_type,entity_id,created_at')
    .single()
  if (error) throw new Error(error.message)
  return {
    id: data.id as string,
    tagId: data.tag_id as string,
    entityType: data.entity_type as TaggableEntityType,
    entityId: data.entity_id as string,
    createdAt: data.created_at as string,
  }
}

export async function untagEntity(entityTagId: string): Promise<void> {
  const { organizationId } = await currentOrganization()
  const { error } = await supabase!
    .from('entity_tags')
    .delete()
    .eq('id', entityTagId)
    .eq('organization_id', organizationId)
  if (error) throw new Error(error.message)
}

export async function fetchEntityTags(entityType: TaggableEntityType, entityId: string): Promise<Tag[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('entity_tags')
    .select(`id,tags(${TAG_COLUMNS})`)
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { tags: TagRow | TagRow[] | null }[])
    .map((row) => (Array.isArray(row.tags) ? row.tags[0] : row.tags))
    .filter((tag): tag is TagRow => Boolean(tag))
    .map(toTag)
}
