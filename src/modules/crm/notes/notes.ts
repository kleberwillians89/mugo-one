import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization, currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { NOTE_COLUMNS, toNote, type Note, type NoteEntityType, type NoteRow } from './note.types'

export async function fetchNotes(entityType: NoteEntityType, entityId: string): Promise<Note[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('notes')
    .select(NOTE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as NoteRow[]).map(toNote)
}

/** Grava a nota; o banco registra 'note_added' na timeline automaticamente (trigger notes_log_activity). */
export async function addNote(entityType: NoteEntityType, entityId: string, content: string): Promise<Note> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('notes')
    .insert({
      organization_id: organizationId,
      entity_type: entityType,
      entity_id: entityId,
      author_user_id: user.id,
      content: content.trim(),
    })
    .select(NOTE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toNote(data as NoteRow)
}
