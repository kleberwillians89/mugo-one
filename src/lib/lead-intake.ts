import { supabase } from './supabase'
import { authenticatedOrganization } from './records'
import { publicEnv } from './publicEnv'

export type LeadIntakeEndpointStatus = 'active' | 'disabled'

export type LeadIntakeEndpoint = {
  id: string
  name: string
  publicKey: string
  status: LeadIntakeEndpointStatus
  eventCount: number
  lastEventAt: string | null
  createdAt: string
}

type EndpointRow = {
  id: string; name: string; public_key: string; status: LeadIntakeEndpointStatus
  event_count: number; last_event_at: string | null; created_at: string
}

const ENDPOINT_COLUMNS = 'id,name,public_key,status,event_count,last_event_at,created_at'

function mapEndpoint(row: EndpointRow): LeadIntakeEndpoint {
  return {
    id: row.id, name: row.name, publicKey: row.public_key, status: row.status,
    eventCount: row.event_count, lastEventAt: row.last_event_at, createdAt: row.created_at,
  }
}

export function leadIntakeFunctionUrl(publicKey: string): string {
  return `${publicEnv.supabaseUrl}/functions/v1/lead-intake/${publicKey}`
}

export async function fetchLeadIntakeEndpoints(): Promise<LeadIntakeEndpoint[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('lead_intake_endpoints')
    .select(ENDPOINT_COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapEndpoint)
}

export async function createLeadIntakeEndpoint(name: string): Promise<LeadIntakeEndpoint> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('create_lead_intake_endpoint', { p_organization_id: organizationId, p_name: name })
  if (error) throw error
  return mapEndpoint(data as EndpointRow)
}

export async function rotateLeadIntakeEndpointKey(endpointId: string): Promise<LeadIntakeEndpoint> {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('rotate_lead_intake_endpoint_key', { p_endpoint_id: endpointId })
  if (error) throw error
  return mapEndpoint(data as EndpointRow)
}

export async function setLeadIntakeEndpointStatus(endpointId: string, status: LeadIntakeEndpointStatus): Promise<LeadIntakeEndpoint> {
  await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('set_lead_intake_endpoint_status', { p_endpoint_id: endpointId, p_status: status })
  if (error) throw error
  return mapEndpoint(data as EndpointRow)
}

export type LeadIntakeEventStatus = 'received' | 'processing' | 'processed' | 'duplicate' | 'identity_conflict' | 'invalid' | 'failed'

export const LEAD_INTAKE_EVENT_STATUS_LABEL: Record<LeadIntakeEventStatus, string> = {
  received: 'Recebido', processing: 'Processando', processed: 'Processado', duplicate: 'Duplicado',
  identity_conflict: 'Conflito de identidade', invalid: 'Inválido', failed: 'Falhou',
}

export type LeadIntakeEvent = {
  id: string
  name: string | null
  email: string | null
  channel: string
  provider: string
  processingStatus: LeadIntakeEventStatus
  resolvedLeadId: string | null
  resolvedCustomerId: string | null
  createdAt: string
}

type EventRow = {
  id: string; name: string | null; email: string | null; channel: string; provider: string
  processing_status: LeadIntakeEventStatus; resolved_lead_id: string | null; resolved_customer_id: string | null; created_at: string
}

export async function fetchLeadIntakeEvents(limit = 50): Promise<LeadIntakeEvent[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('lead_intake_events')
    .select('id,name,email,channel,provider,processing_status,resolved_lead_id,resolved_customer_id,created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row: EventRow) => ({
    id: row.id, name: row.name, email: row.email, channel: row.channel, provider: row.provider,
    processingStatus: row.processing_status, resolvedLeadId: row.resolved_lead_id, resolvedCustomerId: row.resolved_customer_id,
    createdAt: row.created_at,
  }))
}

export type Touchpoint = {
  id: string
  channel: string
  provider: string
  source: string | null
  campaign: string | null
  occurredAt: string
}

type TouchpointRow = { id: string; channel: string; provider: string; source: string | null; campaign: string | null; occurred_at: string }

export async function fetchTouchpointsForEntity(entityType: 'customer' | 'lead', entityId: string, limit = 20): Promise<Touchpoint[]> {
  await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('touchpoints')
    .select('id,channel,provider,source,campaign,occurred_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row: TouchpointRow) => ({
    id: row.id, channel: row.channel, provider: row.provider, source: row.source, campaign: row.campaign, occurredAt: row.occurred_at,
  }))
}
