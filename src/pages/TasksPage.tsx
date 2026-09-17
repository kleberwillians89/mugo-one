import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { PageHeader, PrimaryButton, SearchInput, SecondaryButton, StatusBadge } from '../components/ui'
import { NewTaskModal } from '../components/NewTaskModal'
import { TaskDetailDrawer } from '../components/TaskDetailDrawer'
import { useToast } from '../components/ui'
import { TeamMember, fetchTeamMembers } from '../lib/team'
import {
  KANBAN_STATUSES, TASK_ENTITY_TYPE_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, Task, TaskPriority, TaskStatus,
  dueLabel, fetchTasks, positionBetween, updateTaskStatus,
} from '../lib/tasks'
import './TasksPage.css'

const PRIORITY_TONE: Record<TaskPriority, 'success' | 'warning' | 'danger' | 'neutral'> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' }

type DueFilter = 'all' | 'overdue' | 'today' | 'none'

function TaskCard({ task, onOpen, dragging, onDragStart, onDragEnd }: { task: Task; onOpen: () => void; dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void }) {
  const due = dueLabel(task.dueAt)
  return (
    <article className={`task-card ${dragging ? 'dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen} tabIndex={0} role="button" aria-label={task.title}>
      <div className="task-card-top">
        <span className={`task-card-priority tone-${PRIORITY_TONE[task.priority]}`}>{TASK_PRIORITY_LABEL[task.priority]}</span>
        {due && <span className={`task-card-due ${due.overdue ? 'overdue' : ''}`}>{due.text}</span>}
      </div>
      <strong className="task-card-title">{task.title}</strong>
      {task.entityType && <span className="task-card-entity">{TASK_ENTITY_TYPE_LABEL[task.entityType]}</span>}
    </article>
  )
}

export function TasksPage() {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'me' | string>('all')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [search, setSearch] = useState('')
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchTasks({ assigneeUserId: assigneeFilter === 'all' ? undefined : assigneeFilter, priority: priorityFilter || undefined, search: search || undefined })
      .then(setTasks).catch(() => setError('Não foi possível carregar as tarefas.')).finally(() => setLoading(false))
  }, [assigneeFilter, priorityFilter, search])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetchTeamMembers().then(setMembers).catch(() => setMembers([])) }, [])

  const visibleTasks = useMemo(() => {
    if (dueFilter === 'all') return tasks
    return tasks.filter((task) => {
      const label = dueLabel(task.dueAt)
      if (dueFilter === 'none') return !task.dueAt
      if (dueFilter === 'overdue') return label?.overdue ?? false
      if (dueFilter === 'today') return label?.text === 'Hoje'
      return true
    })
  }, [tasks, dueFilter])

  const columns = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>(KANBAN_STATUSES.map((status) => [status, []]))
    for (const task of visibleTasks) byStatus.get(task.status)?.push(task)
    return byStatus
  }, [visibleTasks])

  const moveTask = async (task: Task, newStatus: TaskStatus, dropIndex: number, columnTasks: Task[]) => {
    const others = columnTasks.filter((t) => t.id !== task.id)
    const before = others[dropIndex - 1]?.position ?? null
    const after = others[dropIndex]?.position ?? null
    const newPosition = positionBetween(before, after)
    const previous = tasks
    setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: newStatus, position: newPosition } : t)))
    try {
      await updateTaskStatus(task.id, task.updatedAt, newStatus, newPosition)
      load()
    } catch (reason) {
      setTasks(previous)
      toast.push(reason instanceof Error ? reason.message : 'Não foi possível mover a tarefa.', { tone: 'error' })
    }
  }

  const onDrop = (status: TaskStatus, dropIndex: number) => (event: React.DragEvent) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/task-id')
    const task = tasks.find((t) => t.id === taskId)
    setDraggingId(null)
    if (!task) return
    void moveTask(task, status, dropIndex, columns.get(status) ?? [])
  }

  const hasFilters = assigneeFilter !== 'all' || priorityFilter !== '' || dueFilter !== 'all' || search !== ''

  return <div className="page tasks-page">
    {newTaskOpen && <NewTaskModal close={() => setNewTaskOpen(false)} onCreated={() => load()} />}
    <TaskDetailDrawer taskId={openTaskId} open={openTaskId !== null} onClose={() => setOpenTaskId(null)} onChanged={load} />

    <PageHeader title="Tarefas" description="O que precisa ser feito, quem está cuidando e quando vence." actions={<PrimaryButton icon={<Plus size={16} />} onClick={() => setNewTaskOpen(true)}>Nova tarefa</PrimaryButton>} />

    <div className="tasks-toolbar">
      <SearchInput value={search} onChange={setSearch} placeholder="Buscar tarefa…" />
      <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
        <option value="all">Todas</option>
        <option value="me">Minhas tarefas</option>
        {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}</option>)}
      </select>
      <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}>
        <option value="">Toda prioridade</option>
        {(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
      </select>
      <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as DueFilter)}>
        <option value="all">Todo prazo</option>
        <option value="overdue">Atrasadas</option>
        <option value="today">Hoje</option>
        <option value="none">Sem prazo</option>
      </select>
      {hasFilters && <SecondaryButton onClick={() => { setAssigneeFilter('all'); setPriorityFilter(''); setDueFilter('all'); setSearch('') }}>Limpar filtros</SecondaryButton>}
    </div>

    {error && <div className="notice"><AlertTriangle size={18} /><span>{error}</span></div>}

    {loading ? <div className="empty card"><h3>Carregando tarefas…</h3></div>
      : tasks.length === 0 ? <div className="empty card"><h3>Nenhuma tarefa pendente.</h3><p>Crie a primeira tarefa para começar a organizar o trabalho.</p><PrimaryButton icon={<Plus size={16} />} onClick={() => setNewTaskOpen(true)}>Criar primeira tarefa</PrimaryButton></div>
      : <div className="tasks-board">
          {KANBAN_STATUSES.map((status) => {
            const columnTasks = columns.get(status) ?? []
            return (
              <section key={status} className="tasks-column" onDragOver={(e) => e.preventDefault()} onDrop={onDrop(status, columnTasks.length)}>
                <header><strong>{TASK_STATUS_LABEL[status]}</strong><StatusBadge tone="neutral">{columnTasks.length}</StatusBadge></header>
                <div className="tasks-column-cards">
                  {columnTasks.map((task, index) => (
                    <div key={task.id} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => { e.stopPropagation(); onDrop(status, index)(e) }}>
                      <TaskCard
                        task={task}
                        dragging={draggingId === task.id}
                        onOpen={() => setOpenTaskId(task.id)}
                        onDragStart={(e) => { e.dataTransfer.setData('text/task-id', task.id); setDraggingId(task.id) }}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    </div>
                  ))}
                  {columnTasks.length === 0 && <p className="tasks-column-empty">Nada aqui.</p>}
                </div>
              </section>
            )
          })}
        </div>}
  </div>
}
