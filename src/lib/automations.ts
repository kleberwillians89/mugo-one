import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'greater_than' | 'less_than' | 'in' | 'not_in'
export type ActionType = 'create_task' | 'send_email'
export type RunStatus = 'queued' | 'running' | 'completed' | 'partially_failed' | 'failed' | 'skipped'

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada', archived: 'Arquivada' }
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { queued: 'Na fila', running: 'Executando', completed: 'Concluída', partially_failed: 'Parcialmente falhou', failed: 'Falhou', skipped: 'Não se aplicou' }
export const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  equals: 'é igual a', not_equals: 'é diferente de', contains: 'contém', not_contains: 'não contém',
  is_empty: 'está vazio', is_not_empty: 'não está vazio', greater_than: 'maior que', less_than: 'menor que', in: 'está em', not_in: 'não está em',
}

// Eventos com emissor real nesta sprint — em linguagem humana
// (briefing §34, "não mostrar nomes técnicos sem contexto").
export const TRIGGER_TYPES: { value: string; label: string }[] = [
  { value: 'lead.created', label: 'Novo lead criado' },
  { value: 'lead.converted', label: 'Lead convertido em cliente' },
  { value: 'deal.stage_changed', label: 'Negócio mudou de etapa' },
  { value: 'deal.won', label: 'Negócio ganho' },
  { value: 'deal.lost', label: 'Negócio perdido' },
  { value: 'sale.created', label: 'Venda criada' },
  { value: 'task.created', label: 'Tarefa criada' },
  { value: 'task.assigned', label: 'Tarefa atribuída' },
  { value: 'task.started', label: 'Tarefa iniciada' },
  { value: 'task.completed', label: 'Tarefa concluída' },
  { value: 'task.reopened', label: 'Tarefa reaberta' },
  { value: 'task.cancelled', label: 'Tarefa cancelada' },
  { value: 'conversation.created', label: 'Conversa iniciada' },
  { value: 'conversation.closed', label: 'Conversa fechada' },
  { value: 'message.received', label: 'Mensagem recebida' },
  { value: 'message.sent', label: 'Mensagem enviada' },
  { value: 'message.delivered', label: 'Mensagem entregue' },
  { value: 'message.failed', label: 'Mensagem falhou' },
]

export type Automation = {
  id: string
  name: string
  description: string | null
  status: AutomationStatus
  triggerType: string
  onError: 'continue' | 'stop'
  version: number
  createdAt: string
  updatedAt: string
  enabledAt: string | null
}

type AutomationRow = {
  id: string; name: string; description: string | null; status: AutomationStatus; trigger_type: string
  on_error: 'continue' | 'stop'; version: number; created_at: string; updated_at: string; enabled_at: string | null
}

function mapAutomation(row: AutomationRow): Automation {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status, triggerType: row.trigger_type,
    onError: row.on_error, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, enabledAt: row.enabled_at,
  }
}

const AUTOMATION_COLUMNS = 'id,name,description,status,trigger_type,on_error,version,created_at,updated_at,enabled_at'

export async function fetchAutomations(): Promise<Automation[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('automations').select(AUTOMATION_COLUMNS).eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAutomation)
}

export async function fetchAutomation(id: string): Promise<Automation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('automations').select(AUTOMATION_COLUMNS).eq('id', id).single()
  if (error) throw new Error(error.message)
  return mapAutomation(data as AutomationRow)
}

export type AutomationCondition = { id?: string; fieldPath: string; operator: ConditionOperator; value: string; position: number }
export type AutomationAction = { id?: string; actionType: ActionType; configuration: Record<string, unknown>; position: number; enabled: boolean }

export async function fetchAutomationConditions(automationId: string): Promise<AutomationCondition[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('automation_conditions').select('id,field_path,operator,value,position').eq('automation_id', automationId).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string; field_path: string; operator: ConditionOperator; value: unknown; position: number }) => ({
    id: row.id, fieldPath: row.field_path, operator: row.operator, value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? ''), position: row.position,
  }))
}

export async function fetchAutomationActions(automationId: string): Promise<AutomationAction[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('automation_actions').select('id,action_type,configuration,position,enabled').eq('automation_id', automationId).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string; action_type: ActionType; configuration: Record<string, unknown>; position: number; enabled: boolean }) => ({
    id: row.id, actionType: row.action_type, configuration: row.configuration, position: row.position, enabled: row.enabled,
  }))
}

export async function createAutomation(input: { name: string; triggerType: string; description?: string; onError?: 'continue' | 'stop' }): Promise<Automation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('create_automation', {
    p_organization_id: organizationId, p_name: input.name, p_trigger_type: input.triggerType,
    p_description: input.description ?? null, p_on_error: input.onError ?? 'continue',
  })
  if (error) throw new Error(error.message)
  return mapAutomation(data as AutomationRow)
}

export async function updateAutomation(id: string, input: { name: string; triggerType: string; description?: string; onError?: 'continue' | 'stop' }): Promise<Automation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.rpc('update_automation', {
    p_automation_id: id, p_name: input.name, p_trigger_type: input.triggerType,
    p_description: input.description ?? null, p_on_error: input.onError ?? 'continue',
  })
  if (error) throw new Error(error.message)
  return mapAutomation(data as AutomationRow)
}

export async function setAutomationConditions(automationId: string, conditions: AutomationCondition[]): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const payload = conditions.map((c, index) => ({ field_path: c.fieldPath, operator: c.operator, value: c.value, position: index }))
  const { error } = await supabase.rpc('set_automation_conditions', { p_automation_id: automationId, p_conditions: payload })
  if (error) throw new Error(error.message)
}

export async function setAutomationActions(automationId: string, actions: AutomationAction[]): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const payload = actions.map((a, index) => ({ action_type: a.actionType, configuration: a.configuration, position: index, enabled: a.enabled }))
  const { error } = await supabase.rpc('set_automation_actions', { p_automation_id: automationId, p_actions: payload })
  if (error) throw new Error(error.message)
}

export async function setAutomationStatus(id: string, status: AutomationStatus): Promise<Automation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.rpc('set_automation_status', { p_automation_id: id, p_new_status: status })
  if (error) throw new Error(error.message)
  return mapAutomation(data as AutomationRow)
}

export async function duplicateAutomation(id: string): Promise<Automation> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.rpc('duplicate_automation', { p_automation_id: id })
  if (error) throw new Error(error.message)
  return mapAutomation(data as AutomationRow)
}

export type AutomationRun = {
  id: string
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string
  eventType?: string
}

export async function fetchAutomationRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase
    .from('automation_runs')
    .select('id,status,started_at,finished_at,error_message,created_at,domain_events(event_type)')
    .eq('automation_id', automationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string; status: RunStatus; started_at: string | null; finished_at: string | null; error_message: string | null; created_at: string; domain_events?: { event_type: string }[] | null }) => ({
    id: row.id, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, errorMessage: row.error_message, createdAt: row.created_at, eventType: row.domain_events?.[0]?.event_type,
  }))
}

export type AutomationActionRun = { id: string; status: string; errorCode: string | null; errorMessage: string | null; outputSnapshot: Record<string, unknown> }

export async function fetchAutomationActionRuns(runId: string): Promise<AutomationActionRun[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('automation_action_runs').select('id,status,error_code,error_message,output_snapshot').eq('automation_run_id', runId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string; status: string; error_code: string | null; error_message: string | null; output_snapshot: Record<string, unknown> }) => ({
    id: row.id, status: row.status, errorCode: row.error_code, errorMessage: row.error_message, outputSnapshot: row.output_snapshot,
  }))
}
