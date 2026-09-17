import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, Task, TaskEntityType, dueLabel, fetchTasksForEntity } from '../lib/tasks'
import { NewTaskModal } from './NewTaskModal'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { PrimaryButton, SecondaryButton, StatusBadge } from './ui'
import './EntityTasksBlock.css'

/**
 * Bloco mínimo de Tarefas reutilizável em qualquer 360 (Cliente, Lead,
 * Negócio, Venda — briefing §26-29). Uma implementação só, nunca uma
 * por entidade: a única coisa que muda é entityType/entityId passados
 * para fetchTasksForEntity/NewTaskModal.
 */
export function EntityTasksBlock({ entityType, entityId, entityLabel, defaultMetadata }: { entityType: TaskEntityType; entityId: string; entityLabel?: string; defaultMetadata?: Record<string, unknown> }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const load = useCallback(() => { fetchTasksForEntity(entityType, entityId).then(setTasks).catch(() => setTasks([])).finally(() => setLoading(false)) }, [entityType, entityId])
  useEffect(() => { load() }, [load])

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const recentlyDone = tasks.filter((t) => t.status === 'done').slice(0, 5)

  return <section className="entity-tasks-block">
    {newTaskOpen && <NewTaskModal close={() => setNewTaskOpen(false)} onCreated={load} defaultEntityType={entityType} defaultEntityId={entityId} defaultEntityLabel={entityLabel} defaultMetadata={defaultMetadata} />}
    <TaskDetailDrawer taskId={openTaskId} open={openTaskId !== null} onClose={() => setOpenTaskId(null)} onChanged={load} />
    <header><strong>Tarefas</strong><SecondaryButton icon={<Plus size={14} />} onClick={() => setNewTaskOpen(true)}>Nova tarefa</SecondaryButton></header>
    {loading ? <p className="entity-tasks-empty">Carregando…</p> : tasks.length === 0 ? <p className="entity-tasks-empty">Nenhuma tarefa ainda.</p> : <>
      {open.length > 0 && <div className="entity-tasks-list">
        {open.map((task) => { const due = dueLabel(task.dueAt); return (
          <button key={task.id} className="entity-task-row" onClick={() => setOpenTaskId(task.id)}>
            <span>{task.title}</span>
            <span className="entity-task-row-meta"><StatusBadge tone="neutral">{TASK_STATUS_LABEL[task.status]}</StatusBadge>{due && <em className={due.overdue ? 'overdue' : ''}>{due.text}</em>}<small>{TASK_PRIORITY_LABEL[task.priority]}</small></span>
          </button>
        )})}
      </div>}
      {recentlyDone.length > 0 && <details className="entity-tasks-done"><summary>{recentlyDone.length} concluída(s) recentemente</summary>
        {recentlyDone.map((task) => <button key={task.id} className="entity-task-row done" onClick={() => setOpenTaskId(task.id)}><span>{task.title}</span></button>)}
      </details>}
    </>}
    {!loading && tasks.length === 0 && <PrimaryButton icon={<Plus size={15} />} onClick={() => setNewTaskOpen(true)}>Criar primeira tarefa</PrimaryButton>}
  </section>
}
