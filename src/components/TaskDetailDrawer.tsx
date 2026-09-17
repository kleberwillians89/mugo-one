import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { dateTime, shortDate } from '../lib/format'
import { EntityActivity, fetchEntityActivities } from '../lib/activities'
import { TeamMember, fetchTeamMembers } from '../lib/team'
import {
  TASK_ENTITY_TYPE_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, Task, TaskPriority, TaskStatus,
  assignTask, fetchRelatedEntityLabel, fetchTask, updateTaskDetails, updateTaskStatus,
} from '../lib/tasks'
import { Drawer, PrimaryButton, SecondaryButton, StatusBadge } from './ui'
import './TaskDetailDrawer.css'

const STATUS_TONE: Record<TaskStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { todo: 'neutral', in_progress: 'warning', waiting: 'warning', done: 'success', cancelled: 'danger' }

function goToEntity(entityType: string, entityId: string) {
  const path = entityType === 'customer' ? `/clientes/${entityId}` : entityType === 'sale' ? `/vendas/${entityId}` : null
  if (!path) return
  history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'))
}

export function TaskDetailDrawer({ taskId, open, onClose, onChanged }: { taskId: string | null; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const [task, setTask] = useState<Task | null>(null)
  const [activities, setActivities] = useState<EntityActivity[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [relatedLabel, setRelatedLabel] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', description: '', priority: 'normal' as TaskPriority, dueAt: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!taskId) return
    fetchTask(taskId).then((row) => {
      setTask(row)
      setDraft({ title: row.title, description: row.description ?? '', priority: row.priority, dueAt: row.dueAt ? row.dueAt.slice(0, 10) : '' })
      if (!row.entityType) setRelatedLabel('')
    }).catch(() => setError('Não foi possível carregar a tarefa.'))
    fetchEntityActivities('task', taskId).then(setActivities).catch(() => setActivities([]))
  }, [taskId])
  useEffect(() => { if (open) { load(); fetchTeamMembers().then(setMembers).catch(() => setMembers([])) } }, [open, load])
  useEffect(() => {
    if (!task?.entityType || !task.entityId) return
    let cancelled = false
    fetchRelatedEntityLabel(task.entityType, task.entityId).then((label) => { if (!cancelled) setRelatedLabel(label) }).catch(() => { if (!cancelled) setRelatedLabel('') })
    return () => { cancelled = true }
  }, [task?.entityType, task?.entityId])

  const assigneeName = (userId: string | null) => userId ? (members.find((m) => m.user_id === userId)?.full_name || members.find((m) => m.user_id === userId)?.email || 'Usuário inativo') : '—'

  const saveDetails = async () => {
    if (!task) return
    setSaving(true); setError('')
    try {
      await updateTaskDetails(task.id, task.updatedAt, { title: draft.title, description: draft.description, priority: draft.priority, dueAt: draft.dueAt ? `${draft.dueAt}T23:59:59` : null, clearDueAt: !draft.dueAt })
      setEditing(false)
      load(); onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.')
    } finally { setSaving(false) }
  }

  const changeStatus = async (newStatus: TaskStatus) => {
    if (!task) return
    setSaving(true); setError('')
    try {
      await updateTaskStatus(task.id, task.updatedAt, newStatus)
      load(); onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível mudar o status.')
    } finally { setSaving(false) }
  }

  const changeAssignee = async (userId: string) => {
    if (!task) return
    setSaving(true); setError('')
    try {
      await assignTask(task.id, task.updatedAt, userId || null)
      load(); onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atribuir.')
    } finally { setSaving(false) }
  }

  return <Drawer open={open} onClose={onClose} side="right" aria-label="Detalhe da tarefa">
    <div className="task-detail-drawer">
      {!task ? <p>Carregando…</p> : <>
        <header className="task-detail-head">
          <StatusBadge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</StatusBadge>
          {editing
            ? <input className="task-detail-title-input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            : <h2>{task.title}</h2>}
          <button className="task-detail-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>

        {editing
          ? <textarea className="task-detail-description-input" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Descrição" />
          : <p className="task-detail-description">{task.description || 'Sem descrição.'}</p>}

        <dl className="task-detail-fields">
          <div><dt>Prioridade</dt><dd>{editing ? <select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as TaskPriority }))}>{(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}</select> : TASK_PRIORITY_LABEL[task.priority]}</dd></div>
          <div><dt>Responsável</dt><dd><select value={task.assigneeUserId ?? ''} onChange={(e) => void changeAssignee(e.target.value)} disabled={saving}><option value="">—</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</select>{task.assigneeUserId && !members.some((m) => m.user_id === task.assigneeUserId) && <small> ({assigneeName(task.assigneeUserId)})</small>}</dd></div>
          <div><dt>Prazo</dt><dd>{editing ? <input type="date" value={draft.dueAt} onChange={(e) => setDraft((d) => ({ ...d, dueAt: e.target.value }))} /> : (task.dueAt ? shortDate(task.dueAt) : 'Sem prazo')}</dd></div>
          {task.entityType && <div><dt>Relacionado a</dt><dd>{TASK_ENTITY_TYPE_LABEL[task.entityType]}{relatedLabel ? ` — ${relatedLabel}` : ''}{(task.entityType === 'customer' || task.entityType === 'sale') && task.entityId && <button className="task-detail-link" onClick={() => goToEntity(task.entityType!, task.entityId!)}>Abrir</button>}</dd></div>}
          <div><dt>Criada em</dt><dd>{dateTime(task.createdAt)}</dd></div>
          {task.completedAt && <div><dt>Concluída em</dt><dd>{dateTime(task.completedAt)}</dd></div>}
        </dl>

        {error && <div className="form-error">{error}</div>}

        <div className="task-detail-actions">
          {editing
            ? <><SecondaryButton onClick={() => setEditing(false)}>Cancelar</SecondaryButton><PrimaryButton loading={saving} onClick={saveDetails}><Check size={15} />Salvar</PrimaryButton></>
            : <SecondaryButton onClick={() => setEditing(true)}>Editar</SecondaryButton>}
          {task.status === 'todo' && <PrimaryButton loading={saving} onClick={() => changeStatus('in_progress')}>Iniciar</PrimaryButton>}
          {task.status !== 'done' && task.status !== 'cancelled' && <PrimaryButton loading={saving} onClick={() => changeStatus('done')}>Concluir</PrimaryButton>}
          {(task.status === 'done' || task.status === 'cancelled') && <SecondaryButton loading={saving} onClick={() => changeStatus('todo')}>Reabrir</SecondaryButton>}
          {task.status !== 'done' && task.status !== 'cancelled' && <SecondaryButton loading={saving} onClick={() => changeStatus('cancelled')}>Cancelar</SecondaryButton>}
        </div>

        <h3 className="task-detail-timeline-heading">Atividades</h3>
        <div className="task-activity-timeline">
          {activities.length === 0 ? <p className="task-detail-empty">Nenhuma atividade ainda.</p> : activities.map((activity) => <article key={activity.id}><strong>{activity.title}</strong><time>{dateTime(activity.createdAt)}</time></article>)}
        </div>
      </>}
    </div>
  </Drawer>
}
