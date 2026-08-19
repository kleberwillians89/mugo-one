import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type WaitlistStatus = 'waiting'|'notified'|'fulfilled'|'cancelled'

export type WaitlistEntry = {
  entry_id: string; client_id: string; client_name: string; perfume_id: string; perfume_name: string
  brand_house: string | null; requested_ml: number; status: WaitlistStatus; created_at: string; notes: string | null
  available_ml: number; ready: boolean
}

export async function fetchWaitlistQueue() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('waitlist_queue', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as WaitlistEntry[]
}

export async function addWaitlistEntry(clientId: string, perfumeId: string, requestedMl: number, notes?: string) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('waitlist_add', { p_client_id: clientId, p_perfume_id: perfumeId, p_requested_ml: requestedMl, p_notes: notes || null })
  if (error) throw new Error(error.message)
}

export async function setWaitlistStatus(entryId: string, status: Exclude<WaitlistStatus, 'waiting'>) {
  await authenticatedOrganization()
  const { error } = await supabase!.rpc('waitlist_set_status', { p_entry_id: entryId, p_status: status, p_sale_id: null })
  if (error) throw new Error(error.message)
}

export function goToWaitlist() {
  history.pushState({}, '', '/interessados')
  dispatchEvent(new PopStateEvent('popstate'))
}
