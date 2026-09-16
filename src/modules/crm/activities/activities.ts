import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { ACTIVITY_COLUMNS, toActivity, type Activity, type ActivityEntityType, type ActivityRow } from './activity.types'

/**
 * Só leitura — toda escrita em `activities` acontece via triggers no
 * banco (log_activity(), security definer), nunca por INSERT direto do
 * frontend. Ver docs/CRM_DOMAIN_MODEL.md.
 */
export async function fetchActivities(entityType: ActivityEntityType, entityId: string): Promise<Activity[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as ActivityRow[]).map(toActivity)
}
