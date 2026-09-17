import { supabase } from './supabase'

export type EntityActivity = { id: string; activityType: string; title: string; description: string | null; createdAt: string }

/**
 * Timeline genérica de qualquer entidade com `entity_belongs_to_organization`
 * (customer/company/contact/lead/deal/sale/catalog_item/task). Extraído de
 * sale-items.ts (Fase E/F) para reaproveitar entre Venda 360 e Task
 * Engine — mesmo mecanismo de evento (activities), nunca duas timelines
 * concorrentes (ver docs/TASK_ENGINE_MIGRATION_PLAN.md §16).
 */
export async function fetchEntityActivities(entityType: string, entityId: string): Promise<EntityActivity[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('activities').select('id,activity_type,title,description,created_at').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ id: row.id as string, activityType: row.activity_type as string, title: row.title as string, description: row.description as string | null, createdAt: row.created_at as string }))
}
