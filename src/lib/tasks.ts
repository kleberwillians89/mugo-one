import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TaskEntityType = 'customer' | 'company' | 'contact' | 'lead' | 'deal' | 'sale'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'A fazer', in_progress: 'Em andamento', waiting: 'Aguardando', done: 'Concluído', cancelled: 'Cancelado' }
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
export const TASK_ENTITY_TYPE_LABEL: Record<TaskEntityType, string> = { customer: 'Cliente', company: 'Empresa', contact: 'Contato', lead: 'Lead', deal: 'Negócio', sale: 'Venda' }

/** Colunas do Kanban — cancelada fica fora por padrão (briefing §3: "Canceladas ficam fora do Kanban principal por padrão"). */
export const KANBAN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done']

export type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigneeUserId: string | null
  createdByUserId: string | null
  dueAt: string | null
  startedAt: string | null
  completedAt: string | null
  entityType: TaskEntityType | null
  entityId: string | null
  position: number
  createdAt: string
  updatedAt: string
}

const COLUMNS = 'id,title,description,status,priority,assignee_user_id,created_by_user_id,due_at,started_at,completed_at,entity_type,entity_id,position,created_at,updated_at'

type TaskRow = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: TaskPriority
  assignee_user_id: string | null; created_by_user_id: string | null; due_at: string | null; started_at: string | null; completed_at: string | null
  entity_type: TaskEntityType | null; entity_id: string | null; position: number; created_at: string; updated_at: string
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id, title: row.title, description: row.description, status: row.status, priority: row.priority,
    assigneeUserId: row.assignee_user_id, createdByUserId: row.created_by_user_id, dueAt: row.due_at, startedAt: row.started_at, completedAt: row.completed_at,
    entityType: row.entity_type, entityId: row.entity_id, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export type TaskFilters = { assigneeUserId?: string | 'me'; status?: TaskStatus[]; priority?: TaskPriority; search?: string; includeCancelled?: boolean }

export async function fetchTasks(filters: TaskFilters = {}): Promise<Task[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId, user } = await authenticatedOrganization()
  let query = supabase.from('tasks').select(COLUMNS).eq('organization_id', organizationId).is('deleted_at', null).order('status').order('position')
  if (filters.status?.length) query = query.in('status', filters.status)
  else if (!filters.includeCancelled) query = query.in('status', KANBAN_STATUSES)
  if (filters.assigneeUserId === 'me') query = query.eq('assignee_user_id', user.id)
  else if (filters.assigneeUserId) query = query.eq('assignee_user_id', filters.assigneeUserId)
  if (filters.priority) query = query.eq('priority', filters.priority)
  if (filters.search?.trim()) query = query.ilike('title', `%${filters.search.trim()}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toTask(row as TaskRow))
}

export async function fetchTasksForEntity(entityType: TaskEntityType, entityId: string): Promise<Task[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('tasks').select(COLUMNS).eq('entity_type', entityType).eq('entity_id', entityId).is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toTask(row as TaskRow))
}

export async function fetchTask(taskId: string): Promise<Task> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('tasks').select(COLUMNS).eq('id', taskId).single()
  if (error) throw new Error(error.message)
  return toTask(data as TaskRow)
}

export type NewTaskInput = {
  title: string
  description?: string | null
  priority?: TaskPriority
  assigneeUserId?: string | null
  dueAt?: string | null
  entityType?: TaskEntityType | null
  entityId?: string | null
  // Uso atual: { conversation_id } quando a task nasce de uma
  // conversa (Communication Hub) — sem abrir entityType='conversation'
  // em tasks, ver docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §7.
  metadata?: Record<string, unknown>
}

export async function createTask(input: NewTaskInput): Promise<{ taskId: string }> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('create_task', {
    p_organization_id: organizationId,
    p_title: input.title,
    p_description: input.description || null,
    p_priority: input.priority ?? 'normal',
    p_assignee_user_id: input.assigneeUserId || null,
    p_due_at: input.dueAt || null,
    p_entity_type: input.entityType || null,
    p_entity_id: input.entityId || null,
    p_metadata: input.metadata ?? {},
  })
  if (error) throw new Error(error.message)
  return { taskId: (data as { task_id: string }).task_id }
}

export type TaskDetailsPatch = {
  title?: string
  description?: string | null
  priority?: TaskPriority
  dueAt?: string | null
  clearDueAt?: boolean
  entityType?: TaskEntityType | null
  entityId?: string | null
  clearEntity?: boolean
}

export async function updateTaskDetails(taskId: string, expectedUpdatedAt: string, patch: TaskDetailsPatch): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('update_task_details', {
    p_task_id: taskId,
    p_expected_updated_at: expectedUpdatedAt,
    p_title: patch.title ?? null,
    p_description: patch.description === undefined ? null : (patch.description ?? ''),
    p_priority: patch.priority ?? null,
    p_due_at: patch.dueAt ?? null,
    p_clear_due_at: patch.clearDueAt ?? false,
    p_entity_type: patch.entityType ?? null,
    p_entity_id: patch.entityId ?? null,
    p_clear_entity: patch.clearEntity ?? false,
  })
  if (error) throw new Error(error.message.includes('task_stale') ? 'Esta tarefa foi atualizada por outra pessoa. Recarregue antes de salvar.' : error.message)
}

export async function updateTaskStatus(taskId: string, expectedUpdatedAt: string, newStatus: TaskStatus, newPosition?: number): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('update_task_status', { p_task_id: taskId, p_expected_updated_at: expectedUpdatedAt, p_new_status: newStatus, p_new_position: newPosition ?? null })
  if (error) throw new Error(error.message.includes('task_stale') ? 'Esta tarefa foi movida por outra pessoa. Recarregue antes de tentar de novo.' : error.message)
}

export async function assignTask(taskId: string, expectedUpdatedAt: string, assigneeUserId: string | null): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('assign_task', { p_task_id: taskId, p_expected_updated_at: expectedUpdatedAt, p_assignee_user_id: assigneeUserId })
  if (error) throw new Error(error.message.includes('task_stale') ? 'Esta tarefa foi atualizada por outra pessoa. Recarregue antes de salvar.' : error.message)
}

/**
 * Gaps numéricos (1000, 2000, 3000...) — mover uma task entre duas
 * outras vira um número só (ponto médio), nunca reindexa a coluna
 * inteira. No topo/fim da coluna, soma/subtrai 1000. Ver
 * docs/TASK_ENGINE_MIGRATION_PLAN.md §Position.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000
  if (before === null) return after! - 1000
  if (after === null) return before + 1000
  return Math.round((before + after) / 2)
}

const dueLabelFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

/** "Atrasada"/"Hoje"/"Amanhã" para prazos próximos, data normal para o resto — briefing §24. */
export function dueLabel(dueAt: string | null, now: Date = new Date()): { text: string; overdue: boolean } | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86400000)
  if (days < 0) return { text: 'Atrasada', overdue: true }
  if (days === 0) return { text: 'Hoje', overdue: false }
  if (days === 1) return { text: 'Amanhã', overdue: false }
  return { text: dueLabelFormatter.format(due), overdue: false }
}

export type RelatableEntityOption = { id: string; label: string }

/**
 * Busca para o seletor "Relacionar a" da Nova Tarefa — um por tipo,
 * mesmo padrão simples de searchClients (ilike + limit), sem reusar as
 * fetchCompanies/fetchContacts/fetchLeads/fetchDeals existentes porque
 * elas trazem a lista inteira sem busca por termo (nenhuma tela ainda
 * demandou paginação/busca nesses módulos — ver auditoria da Fase A).
 */
export async function searchRelatableEntities(entityType: TaskEntityType, term: string): Promise<RelatableEntityOption[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  if (entityType === 'customer') {
    const { data, error } = await supabase.from('clients').select('id,name').eq('organization_id', organizationId).is('deleted_at', null).ilike('name', `%${term}%`).order('name').limit(12)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id as string, label: row.name as string }))
  }
  if (entityType === 'company') {
    const { data, error } = await supabase.from('companies').select('id,name').eq('organization_id', organizationId).is('deleted_at', null).ilike('name', `%${term}%`).order('name').limit(12)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id as string, label: row.name as string }))
  }
  if (entityType === 'contact') {
    const { data, error } = await supabase.from('contacts').select('id,name').eq('organization_id', organizationId).is('deleted_at', null).ilike('name', `%${term}%`).order('name').limit(12)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id as string, label: row.name as string }))
  }
  if (entityType === 'lead') {
    const { data, error } = await supabase.from('leads').select('id,name').eq('organization_id', organizationId).ilike('name', `%${term}%`).order('name').limit(12)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id as string, label: row.name as string }))
  }
  if (entityType === 'deal') {
    const { data, error } = await supabase.from('deals').select('id,title').eq('organization_id', organizationId).ilike('title', `%${term}%`).order('title').limit(12)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id as string, label: row.title as string }))
  }
  // 'sale' não tem um nome próprio (é composta por itens) — a task se
  // relaciona a uma venda a partir da própria Venda 360, não por busca
  // aqui (ver §29 do briefing: "Venda → Criar tarefa", fluxo inverso).
  return []
}

/**
 * Nome de exibição da entidade relacionada, para o Drawer de detalhe
 * da tarefa. Só customer/sale têm página própria hoje (Cliente 360/
 * Venda 360) — company/contact/lead/deal mostram nome sem link, para
 * não criar uma página falsa que ainda não existe (ver Fase A).
 */
export async function fetchRelatedEntityLabel(entityType: TaskEntityType, entityId: string): Promise<string> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const table = { customer: 'clients', company: 'companies', contact: 'contacts', lead: 'leads', deal: 'deals', sale: null }[entityType]
  if (entityType === 'sale') {
    const { data } = await supabase.from('sales').select('clients(name)').eq('id', entityId).maybeSingle()
    const clients = data?.clients as { name: string } | { name: string }[] | null
    const name = Array.isArray(clients) ? clients[0]?.name : clients?.name
    return name ? `Venda — ${name}` : 'Venda'
  }
  if (!table) return TASK_ENTITY_TYPE_LABEL[entityType]
  const column = entityType === 'deal' ? 'title' : 'name'
  const { data } = await supabase.from(table).select(column).eq('id', entityId).maybeSingle()
  return (data as Record<string, string> | null)?.[column] ?? TASK_ENTITY_TYPE_LABEL[entityType]
}
