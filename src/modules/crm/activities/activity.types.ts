export type ActivityEntityType = 'customer' | 'company' | 'contact' | 'lead' | 'deal'

export type Activity = {
  id: string
  organizationId: string
  entityType: ActivityEntityType
  entityId: string
  activityType: string
  actorUserId: string | null
  title: string
  description: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type ActivityRow = {
  id: string
  organization_id: string
  entity_type: ActivityEntityType
  entity_id: string
  activity_type: string
  actor_user_id: string | null
  title: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export const ACTIVITY_COLUMNS =
  'id,organization_id,entity_type,entity_id,activity_type,actor_user_id,title,description,metadata,created_at'

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    activityType: row.activity_type,
    actorUserId: row.actor_user_id,
    title: row.title,
    description: row.description,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }
}
