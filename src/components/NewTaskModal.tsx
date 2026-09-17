import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { DateField } from './DateField'
import { TeamMember, fetchTeamMembers } from '../lib/team'
import { NewTaskInput, TASK_ENTITY_TYPE_LABEL, TASK_PRIORITY_LABEL, TaskEntityType, TaskPriority, createTask, searchRelatableEntities } from '../lib/tasks'
import { Modal, EntityCombobox, EntityOption, FormField, PrimaryButton, SecondaryButton } from './ui'

const RELATABLE_TYPES: TaskEntityType[] = ['customer', 'company', 'contact', 'lead', 'deal']

export function NewTaskModal({ close, onCreated, defaultEntityType, defaultEntityId, defaultEntityLabel, defaultMetadata }: {
  close: () => void
  onCreated?: (taskId: string) => void
  defaultEntityType?: TaskEntityType
  defaultEntityId?: string
  defaultEntityLabel?: string
  defaultMetadata?: Record<string, unknown>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [dueAt, setDueAt] = useState('')
  const [relatedType, setRelatedType] = useState<TaskEntityType | ''>(defaultEntityType ?? '')
  const [relatedOption, setRelatedOption] = useState<EntityOption | null>(defaultEntityType && defaultEntityId ? { id: defaultEntityId, label: defaultEntityLabel ?? '' } : null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchTeamMembers().then(setMembers).catch(() => setMembers([])) }, [])

  const relatedSearch = useCallback(async (term: string) => {
    if (!relatedType) return []
    const rows = await searchRelatableEntities(relatedType, term)
    return rows.map((row) => ({ id: row.id, label: row.label }))
  }, [relatedType])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) return setError('Informe o título da tarefa.')
    const input: NewTaskInput = {
      title, description: description || null, priority, assigneeUserId: assigneeUserId || null,
      dueAt: dueAt ? `${dueAt}T23:59:59` : null,
      entityType: relatedType || null, entityId: relatedType ? relatedOption?.id ?? null : null,
      metadata: defaultMetadata,
    }
    if (relatedType && !relatedOption) return setError('Selecione o registro para relacionar, ou volte "Relacionar a" para Nenhum.')
    setSaving(true)
    try {
      const result = await createTask(input)
      onCreated?.(result.taskId)
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a tarefa.')
    } finally { setSaving(false) }
  }

  return <Modal open onClose={close} eyebrow="NOVA TAREFA" title="Adicionar tarefa" footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}><Check size={16} />Salvar tarefa</PrimaryButton>
  </>}>
    <form className="record-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field wide"><FormField label="Título" htmlFor="task-title" required><input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></FormField></div>
        <div className="field wide"><FormField label="Descrição" htmlFor="task-description"><textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} /></FormField></div>
        <FormField label="Responsável" htmlFor="task-assignee"><select id="task-assignee" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}><option value="">—</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}</option>)}</select></FormField>
        <FormField label="Prioridade" htmlFor="task-priority"><select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>{(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((value) => <option key={value} value={value}>{TASK_PRIORITY_LABEL[value]}</option>)}</select></FormField>
        <DateField id="task-due" label="Prazo" value={dueAt} onChange={setDueAt} />
        <FormField label="Relacionar a" htmlFor="task-related-type">
          <select id="task-related-type" value={relatedType} onChange={(e) => { setRelatedType(e.target.value as TaskEntityType | ''); setRelatedOption(null) }}>
            <option value="">Nenhum</option>
            {RELATABLE_TYPES.map((type) => <option key={type} value={type}>{TASK_ENTITY_TYPE_LABEL[type]}</option>)}
          </select>
        </FormField>
        {relatedType && <div className="field wide"><EntityCombobox label={`Buscar ${TASK_ENTITY_TYPE_LABEL[relatedType].toLowerCase()}…`} placeholder="Buscar…" value={relatedOption} search={relatedSearch} onChange={setRelatedOption} /></div>}
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  </Modal>
}
