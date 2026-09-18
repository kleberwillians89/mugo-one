import { useEffect, useState } from 'react'
import { Copy, Pause, Play, Plus, Archive } from 'lucide-react'
import {
  Automation, AutomationStatus, AUTOMATION_STATUS_LABEL, TRIGGER_TYPES,
  createAutomation, duplicateAutomation, fetchAutomations, setAutomationStatus,
} from '../lib/automations'
import { AutomationDetailDrawer } from '../components/AutomationDetailDrawer'
import { Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, FormField } from '../components/ui'
import { useHasPermission } from '../lib/PermissionsContext'
import './AutomationsPage.css'

function triggerLabel(value: string): string {
  return TRIGGER_TYPES.find((t) => t.value === value)?.label ?? value
}

const STATUS_TONE: Record<AutomationStatus, 'success' | 'warning' | 'neutral'> = { draft: 'neutral', active: 'success', paused: 'warning', archived: 'neutral' }

/**
 * /automacoes — briefing §32-33. Builder simples (QUANDO/SE/ENTÃO),
 * não canvas de nodes. Mesmo motor para qualquer segmento — nenhuma
 * automação vem pré-configurada por vertical (briefing §76/§78: sem
 * presets executáveis nesta sprint).
 */
export function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const canCreate = useHasPermission('automations.create')
  const canManage = useHasPermission('automations.manage')

  const load = () => { fetchAutomations().then(setAutomations).catch(() => setAutomations([])) }
  useEffect(load, [])

  const toggle = async (automation: Automation, next: AutomationStatus) => {
    try { await setAutomationStatus(automation.id, next); load() }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível atualizar a automação.') }
  }

  const duplicate = async (automation: Automation) => {
    try { const copy = await duplicateAutomation(automation.id); load(); setOpenId(copy.id) }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível duplicar a automação.') }
  }

  return <div className="page">
    <PageHeader
      eyebrow="AUTOMAÇÕES" title="Automações"
      description="Automatize tarefas repetitivas do seu negócio: quando algo acontece no Mugô One, uma ação roda sozinha."
      actions={canCreate ? <PrimaryButton icon={<Plus size={17} />} onClick={() => setCreating(true)}>Criar automação</PrimaryButton> : undefined}
    />

    {creating && <NewAutomationModal close={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id) }} />}
    {openId && <AutomationDetailDrawer automationId={openId} onClose={() => setOpenId(null)} onChanged={load} />}

    {automations === null ? <p>Carregando…</p> : automations.length === 0 ? (
      <div className="empty card"><h3>Automatize tarefas repetitivas do seu negócio.</h3>
        {canCreate && <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>Criar primeira automação</PrimaryButton>}
      </div>
    ) : (
      <div className="automations-grid">
        {automations.map((automation) => (
          <div key={automation.id} className="card automation-card">
            <div className="automation-card-head">
              <button className="automation-card-title" onClick={() => setOpenId(automation.id)}>{automation.name}</button>
              <StatusBadge tone={STATUS_TONE[automation.status]}>{AUTOMATION_STATUS_LABEL[automation.status].toUpperCase()}</StatusBadge>
            </div>
            <p className="automation-card-trigger">Quando: {triggerLabel(automation.triggerType)}</p>
            {canManage && (
              <div className="automation-card-actions">
                {automation.status !== 'active' && automation.status !== 'archived' && <SecondaryButton icon={<Play size={14} />} onClick={() => toggle(automation, 'active')}>Ativar</SecondaryButton>}
                {automation.status === 'active' && <SecondaryButton icon={<Pause size={14} />} onClick={() => toggle(automation, 'paused')}>Pausar</SecondaryButton>}
                <SecondaryButton icon={<Copy size={14} />} onClick={() => duplicate(automation)}>Duplicar</SecondaryButton>
                {automation.status !== 'archived' && <SecondaryButton icon={<Archive size={14} />} onClick={() => toggle(automation, 'archived')}>Arquivar</SecondaryButton>}
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
}

function NewAutomationModal({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState(TRIGGER_TYPES[0].value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) return setError('Dê um nome à automação.')
    setSaving(true)
    try { const automation = await createAutomation({ name: name.trim(), triggerType }); onCreated(automation.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a automação.') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={close} eyebrow="AUTOMAÇÕES" title="Nova automação" footer={<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton disabled={saving} onClick={submit}>{saving ? 'Criando…' : 'Criar'}</PrimaryButton></>}>
      <div className="team-modal">
        {error && <div className="notice"><span>{error}</span></div>}
        <FormField label="Nome" htmlFor="automation-name"><input id="automation-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></FormField>
        <FormField label="Quando (trigger)" htmlFor="automation-trigger">
          <select id="automation-trigger" value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
            {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FormField>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>A automação nasce como rascunho — configure condições e ações antes de ativar.</p>
      </div>
    </Modal>
  )
}
