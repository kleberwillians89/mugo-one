export type NoteEntityType = 'customer' | 'company' | 'contact' | 'lead' | 'deal'

export type Note = {
  id: string
  organizationId: string
  entityType: NoteEntityType
  entityId: string
  authorUserId: string | null
  content: string
  createdAt: string
  updatedAt: string
}

export type NoteRow = {
  id: string
  organization_id: string
  entity_type: NoteEntityType
  entity_id: string
  author_user_id: string | null
  content: string
  created_at: string
  updated_at: string
}

export const NOTE_COLUMNS = 'id,organization_id,entity_type,entity_id,author_user_id,content,created_at,updated_at'

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    authorUserId: row.author_user_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
