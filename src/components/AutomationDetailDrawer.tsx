import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import {
  Automation, AutomationAction, AutomationCondition, AutomationRun, ActionType, ConditionOperator, OPERATOR_LABEL, RUN_STATUS_LABEL,
  fetchAutomation, fetchAutomationActions, fetchAutomationConditions, fetchAutomationRuns, setAutomationActions, setAutomationConditions, updateAutomation,
} from '../lib/automations'
import { Drawer, PrimaryButton, SecondaryButton, StatusBadge } from './ui'
import { useHasPermission } from '../lib/PermissionsContext'
import './AutomationDetailDrawer.css'

const OPERATORS: ConditionOperator[] = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than', 'in', 'not_in']
// Whitelist de campos úteis (briefing §14/§35 — nunca digitar SQL).
const FIELD_PATHS = [
  'event.payload.interest', 'event.payload.name', 'event.payload.source_channel', 'event.payload.customer_id',
  'event.type', 'entity.type',
]
const RUN_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  completed: 'success', partially_failed: 'warning', failed: 'danger', skipped: 'neutral', queued: 'neutral', running: 'neutral',
}

export function AutomationDetailDrawer({ automationId, onClose, onChanged }: { automationId: string; onClose: () => void; onChanged: () => void }) {
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [conditions, setConditions] = useState<AutomationCondition[]>([])
  const [actions, setActions] = useState<AutomationAction[]>([])
  const [runs, setRuns] = useState<AutomationRun[] | null>(null)
  const [tab, setTab] = useState<'builder' | 'runs'>('builder')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = useHasPermission('automations.edit')

  const load = () => {
    fetchAutomation(automationId).then(setAutomation).catch(() => setAutomation(null))
    fetchAutomationConditions(automationId).then(setConditions).catch(() => setConditions([]))
    fetchAutomationActions(automationId).then((rows) => setActions(rows.length ? rows : [{ actionType: 'create_task', configuration: {}, position: 0, enabled: true }])).catch(() => setActions([]))
    fetchAutomationRuns(automationId).then(setRuns).catch(() => setRuns([]))
  }
  useEffect(load, [automationId])

  const save = async () => {
    if (!automation) return
    setSaving(true)
    setError('')
    try {
      await updateAutomation(automationId, { name: automation.name, triggerType: automation.triggerType, description: automation.description ?? undefined, onError: automation.onError })
      await setAutomationConditions(automationId, conditions)
      await setAutomationActions(automationId, actions.filter((a) => a.enabled))
      onChanged()
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a automação.')
    } finally { setSaving(false) }
  }

  return (
    <Drawer open onClose={onClose} side="right" aria-label="Detalhe da automação">
      <div className="automation-drawer">
        <header className="automation-drawer-head">
          <div>
            <strong>{automation?.name ?? 'Automação'}</strong>
            {automation && <StatusBadge tone={automation.status === 'active' ? 'success' : 'neutral'}>{automation.status.toUpperCase()}</StatusBadge>}
          </div>
          <button className="automation-drawer-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="automation-drawer-tabs">
          <button className={tab === 'builder' ? 'active' : ''} onClick={() => setTab('builder')}>Configuração</button>
          <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Execuções</button>
        </div>

        {tab === 'builder' && automation && (
          <div className="automation-drawer-body">
            <label className="field"><span>Nome</span><input value={automation.name} onChange={(e) => setAutomation({ ...automation, name: e.target.value })} disabled={!canEdit} /></label>

            <section className="automation-section">
              <h4>SE (condições — todas precisam ser verdadeiras)</h4>
              {conditions.map((condition, index) => (
                <div key={index} className="automation-condition-row">
                  <select value={condition.fieldPath} onChange={(e) => setConditions(conditions.map((c, i) => i === index ? { ...c, fieldPath: e.target.value } : c))} disabled={!canEdit}>
                    {FIELD_PATHS.map((path) => <option key={path} value={path}>{path}</option>)}
                  </select>
                  <select value={condition.operator} onChange={(e) => setConditions(conditions.map((c, i) => i === index ? { ...c, operator: e.target.value as ConditionOperator } : c))} disabled={!canEdit}>
                    {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
                  </select>
                  {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (
                    <input value={condition.value} onChange={(e) => setConditions(conditions.map((c, i) => i === index ? { ...c, value: e.target.value } : c))} placeholder="Valor" disabled={!canEdit} />
                  )}
                  {canEdit && <button className="automation-remove-btn" onClick={() => setConditions(conditions.filter((_, i) => i !== index))}><Trash2 size={14} /></button>}
                </div>
              ))}
              {canEdit && <SecondaryButton icon={<Plus size={14} />} onClick={() => setConditions([...conditions, { fieldPath: FIELD_PATHS[0], operator: 'equals', value: '', position: conditions.length }])}>Adicionar condição</SecondaryButton>}
              {conditions.length === 0 && <p className="automation-hint">Sem condições: a automação roda sempre que o evento acontecer.</p>}
            </section>

            <section className="automation-section">
              <h4>ENTÃO (ações, em ordem)</h4>
              {actions.map((action, index) => (
                <div key={index} className="automation-action-row">
                  <select value={action.actionType} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, actionType: e.target.value as ActionType, configuration: {} } : a))} disabled={!canEdit}>
                    <option value="create_task">Criar tarefa</option>
                    <option value="send_email">Enviar e-mail</option>
                  </select>
                  {action.actionType === 'create_task' ? (
                    <>
                      <label className="field"><span>Título</span><input value={String(action.configuration.title ?? '')} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, configuration: { ...a.configuration, title: e.target.value } } : a))} placeholder="Ex.: Entrar em contato com {{lead.name}}" disabled={!canEdit} /></label>
                      <label className="field"><span>Prioridade</span>
                        <select value={String(action.configuration.priority ?? 'normal')} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, configuration: { ...a.configuration, priority: e.target.value } } : a))} disabled={!canEdit}>
                          <option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="field"><span>Destinatário (e-mail, opcional)</span><input value={String(action.configuration.recipient_identity ?? '')} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, configuration: { ...a.configuration, recipient_identity: e.target.value } } : a))} placeholder="Vazio = e-mail já cadastrado" disabled={!canEdit} /></label>
                      <label className="field"><span>Assunto</span><input value={String(action.configuration.subject ?? '')} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, configuration: { ...a.configuration, subject: e.target.value } } : a))} disabled={!canEdit} /></label>
                      <label className="field wide"><span>Mensagem</span><textarea value={String(action.configuration.body_text ?? '')} onChange={(e) => setActions(actions.map((a, i) => i === index ? { ...a, configuration: { ...a.configuration, body_text: e.target.value } } : a))} placeholder="Use {{lead.name}}, {{customer.name}}..." disabled={!canEdit} /></label>
                    </>
                  )}
                  {canEdit && actions.length > 1 && <button className="automation-remove-btn" onClick={() => setActions(actions.filter((_, i) => i !== index))}><Trash2 size={14} /></button>}
                </div>
              ))}
              {canEdit && <SecondaryButton icon={<Plus size={14} />} onClick={() => setActions([...actions, { actionType: 'create_task', configuration: {}, position: actions.length, enabled: true }])}>Adicionar ação</SecondaryButton>}
            </section>

            {error && <div className="form-error">{error}</div>}
            {canEdit && <PrimaryButton loading={saving} onClick={save}>Salvar automação</PrimaryButton>}
          </div>
        )}

        {tab === 'runs' && (
          <div className="automation-drawer-body">
            {runs === null ? <p>Carregando…</p> : runs.length === 0 ? <p className="automation-hint">Nenhuma execução ainda.</p> : (
              <div className="automation-runs-list">
                {runs.map((run) => (
                  <div key={run.id} className="automation-run-row">
                    <span>{run.eventType ?? '—'}</span>
                    <StatusBadge tone={RUN_STATUS_TONE[run.status] ?? 'neutral'}>{RUN_STATUS_LABEL[run.status].toUpperCase()}</StatusBadge>
                    <em>{new Date(run.createdAt).toLocaleString('pt-BR')}</em>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
