import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type ConversationStatus = 'open' | 'pending' | 'closed'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = { open: 'Aberta', pending: 'Pendente', closed: 'Fechada' }
export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'Na fila', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falhou', received: 'Recebida',
}

export type Conversation = {
  id: string
  channel: string
  customerId: string | null
  companyId: string | null
  contactId: string | null
  leadId: string | null
  status: ConversationStatus
  assignedUserId: string | null
  subject: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  unreadCount: number
  updatedAt: string
  createdAt: string
  closedAt: string | null
  customerName?: string | null
  leadName?: string | null
  contactName?: string | null
  companyName?: string | null
}

type ConversationRow = {
  id: string; channel: string; customer_id: string | null; company_id: string | null; contact_id: string | null; lead_id: string | null
  status: ConversationStatus; assigned_user_id: string | null; subject: string | null
  last_message_at: string | null; last_inbound_at: string | null; last_outbound_at: string | null
  unread_count: number; updated_at: string; created_at: string; closed_at: string | null
  clients?: { name: string } | null; leads?: { name: string } | null; contacts?: { name: string } | null; companies?: { name: string } | null
}

const CONVERSATION_COLUMNS = 'id,channel,customer_id,company_id,contact_id,lead_id,status,assigned_user_id,subject,last_message_at,last_inbound_at,last_outbound_at,unread_count,updated_at,created_at,closed_at,clients(name),leads(name),contacts(name),companies(name)'

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id, channel: row.channel, customerId: row.customer_id, companyId: row.company_id, contactId: row.contact_id, leadId: row.lead_id,
    status: row.status, assignedUserId: row.assigned_user_id, subject: row.subject,
    lastMessageAt: row.last_message_at, lastInboundAt: row.last_inbound_at, lastOutboundAt: row.last_outbound_at,
    unreadCount: row.unread_count, updatedAt: row.updated_at, createdAt: row.created_at, closedAt: row.closed_at,
    customerName: row.clients?.name, leadName: row.leads?.name, contactName: row.contacts?.name, companyName: row.companies?.name,
  }
}

export async function fetchConversationsForCustomer(customerId: string, limit = 5): Promise<Conversation[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('customer_id', customerId)
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ConversationRow[]).map(mapConversation)
}

export type ConversationFilters = {
  status?: ConversationStatus[]
  channel?: string
  assignedToMe?: boolean
  unreadOnly?: boolean
  search?: string
}

export async function fetchConversations(filters: ConversationFilters = {}): Promise<Conversation[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId, user } = await authenticatedOrganization()
  let query = supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('organization_id', organizationId)
  if (filters.status?.length) query = query.in('status', filters.status)
  if (filters.channel) query = query.eq('channel', filters.channel)
  if (filters.assignedToMe) query = query.eq('assigned_user_id', user.id)
  if (filters.unreadOnly) query = query.gt('unread_count', 0)
  query = query.order('last_message_at', { ascending: false, nullsFirst: false }).limit(100)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as ConversationRow[]
  const mapped = rows.map(mapConversation)
  if (!filters.search) return mapped
  const term = filters.search.trim().toLowerCase()
  if (!term) return mapped
  return mapped.filter((c) => [c.customerName, c.leadName, c.contactName, c.companyName, c.subject].some((v) => v?.toLowerCase().includes(term)))
}

export async function fetchConversation(conversationId: string): Promise<Conversation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('id', conversationId).single()
  if (error) throw new Error(error.message)
  return mapConversation(data as unknown as ConversationRow)
}

export type Message = {
  id: string
  conversationId: string
  direction: MessageDirection
  channel: string
  messageType: string
  bodyText: string | null
  status: MessageStatus
  errorMessage: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
  createdAt: string
}

type MessageRow = {
  id: string; conversation_id: string; direction: MessageDirection; channel: string; message_type: string
  body_text: string | null; status: MessageStatus; error_message: string | null
  sent_at: string | null; delivered_at: string | null; read_at: string | null; failed_at: string | null; created_at: string
}

export async function fetchMessages(conversationId: string, limit = 50): Promise<Message[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('messages')
    .select('id,conversation_id,direction,channel,message_type,body_text,status,error_message,sent_at,delivered_at,read_at,failed_at,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: MessageRow) => ({
    id: row.id, conversationId: row.conversation_id, direction: row.direction, channel: row.channel, messageType: row.message_type,
    bodyText: row.body_text, status: row.status, errorMessage: row.error_message,
    sentAt: row.sent_at, deliveredAt: row.delivered_at, readAt: row.read_at, failedAt: row.failed_at, createdAt: row.created_at,
  }))
}

export type SendEmailInput = {
  connectionId?: string | null
  customerId?: string | null
  companyId?: string | null
  contactId?: string | null
  leadId?: string | null
  conversationId?: string | null
  recipientIdentity?: string | null
  subject: string
  bodyText: string
}

export async function sendEmailMessage(input: SendEmailInput): Promise<{ conversationId: string; messageId: string }> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      organization_id: organizationId, channel: 'email', connection_id: input.connectionId ?? null,
      customer_id: input.customerId ?? null, company_id: input.companyId ?? null, contact_id: input.contactId ?? null, lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null, recipient_identity: input.recipientIdentity ?? null,
      subject: input.subject, body_text: input.bodyText,
    },
  })
  if (error) throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? error.message)
  const result = data as { data?: { conversation_id: string; message_id: string }; error?: { message: string } }
  if (result.error) throw new Error(result.error.message)
  if (!result.data) throw new Error('Não foi possível enviar o e-mail.')
  return { conversationId: result.data.conversation_id, messageId: result.data.message_id }
}

export async function assignConversation(conversationId: string, expectedUpdatedAt: string, assigneeUserId: string | null): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('assign_conversation', { p_conversation_id: conversationId, p_assignee_user_id: assigneeUserId, p_expected_updated_at: expectedUpdatedAt })
  if (error) throw new Error(error.message)
}

export async function setConversationStatus(conversationId: string, expectedUpdatedAt: string, status: ConversationStatus): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('set_conversation_status', { p_conversation_id: conversationId, p_new_status: status, p_expected_updated_at: expectedUpdatedAt })
  if (error) throw new Error(error.message)
}

export async function markConversationRead(conversationId: string): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message)
}

export type CommunicationConnection = {
  id: string
  provider: string
  channel: string
  name: string
  status: 'not_configured' | 'connected' | 'error' | 'disabled'
  configuration: Record<string, unknown>
}

type ConnectionRow = { id: string; provider: string; channel: string; name: string; status: CommunicationConnection['status']; configuration: Record<string, unknown> }

export async function fetchCommunicationConnections(): Promise<CommunicationConnection[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('communication_connections').select('id,provider,channel,name,status,configuration').eq('organization_id', organizationId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: ConnectionRow) => ({ id: row.id, provider: row.provider, channel: row.channel, name: row.name, status: row.status, configuration: row.configuration }))
}

export async function createEmailConnection(input: { name: string; fromEmail: string; fromName?: string }): Promise<CommunicationConnection> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('communication_connections').insert({
    organization_id: organizationId, provider: 'resend', channel: 'email', name: input.name,
    status: 'connected', configuration: { from_email: input.fromEmail, from_name: input.fromName ?? null },
  }).select('id,provider,channel,name,status,configuration').single()
  if (error) throw new Error(error.message)
  const row = data as ConnectionRow
  return { id: row.id, provider: row.provider, channel: row.channel, name: row.name, status: row.status, configuration: row.configuration }
}
