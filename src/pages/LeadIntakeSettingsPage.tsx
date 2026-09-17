import { useEffect, useState } from 'react'
import { Copy, Plus, RefreshCw, ShieldCheck, UserX } from 'lucide-react'
import { Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge } from '../components/ui'
import { SettingsTabs } from '../components/SettingsTabs'
import { useHasPermission } from '../lib/PermissionsContext'
import {
  LEAD_INTAKE_EVENT_STATUS_LABEL, LeadIntakeEndpoint, LeadIntakeEvent, createLeadIntakeEndpoint, fetchLeadIntakeEndpoints,
  fetchLeadIntakeEvents, leadIntakeFunctionUrl, rotateLeadIntakeEndpointKey, setLeadIntakeEndpointStatus,
} from '../lib/lead-intake'
import './TeamSettingsPage.css'

const EVENT_STATUS_TONE: Record<LeadIntakeEvent['processingStatus'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  received: 'neutral', processing: 'neutral', processed: 'success', duplicate: 'neutral',
  identity_conflict: 'warning', invalid: 'danger', failed: 'danger',
}

/**
 * Configurações → Entradas de Leads. Gestão de endpoints públicos
 * (docs/LEAD_INTAKE_API.md) + inbox somente-leitura dos últimos
 * eventos recebidos — não é um Integration Marketplace nem um painel
 * de observabilidade completo (briefing §28/§30).
 */
export function LeadIntakeSettingsPage() {
  const [endpoints, setEndpoints] = useState<LeadIntakeEndpoint[] | null>(null)
  const [events, setEvents] = useState<LeadIntakeEvent[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const canManage = useHasPermission('lead_intake.manage')

  const load = () => {
    fetchLeadIntakeEndpoints().then(setEndpoints).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os endpoints.'))
    fetchLeadIntakeEvents().then(setEvents).catch(() => {})
  }
  useEffect(load, [])

  return (
    <div className="page">
      <SettingsTabs active="entradas-de-leads"/>
      <PageHeader
        eyebrow="CONFIGURAÇÕES"
        title="Entradas de Leads"
        description="Endpoints públicos para receber leads de site, formulário, webhook ou automação (Zapier/Make/n8n) — sem depender de integração nativa com Meta ou Google."
        actions={canManage ? <PrimaryButton icon={<Plus size={17} />} onClick={() => setCreating(true)}>Novo endpoint</PrimaryButton> : undefined}
      />

      {error && <div className="notice"><span>{error}</span></div>}

      {creating && (
        <CreateEndpointModal close={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />
      )}

      {endpoints === null ? <p>Carregando…</p> : (
        <div className="team-grid">
          {endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} endpoint={endpoint} canManage={canManage} onChanged={load} />
          ))}
          {endpoints.length === 0 && <div className="empty card"><h3>Nenhum endpoint ainda</h3><p>Crie o primeiro endpoint para começar a receber leads de fora do Mugô One.</p></div>}
        </div>
      )}

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card-title"><div><h3>Últimas entradas recebidas</h3><p>Os 50 eventos mais recentes, de todos os endpoints desta organização.</p></div></div>
        {events === null ? <div className="inline-empty">Carregando…</div> : events.length === 0 ? (
          <div className="inline-empty">Nenhuma entrada recebida ainda.</div>
        ) : (
          <div className="team-permission-list">
            {events.map((event) => (
              <div key={event.id} className="team-password-row">
                <span style={{ flex: 1 }}>
                  <strong>{event.name ?? event.email ?? 'Sem identificação'}</strong>{' '}
                  <span style={{ color: 'var(--muted)' }}>via {event.channel} ({event.provider})</span>
                </span>
                <StatusBadge tone={EVENT_STATUS_TONE[event.processingStatus]}>{LEAD_INTAKE_EVENT_STATUS_LABEL[event.processingStatus].toUpperCase()}</StatusBadge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EndpointCard({ endpoint, canManage, onChanged }: { endpoint: LeadIntakeEndpoint; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(leadIntakeFunctionUrl(endpoint.publicKey)); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* clipboard indisponível — usuário pode selecionar o texto manualmente */ }
  }
  const rotate = async () => {
    if (!confirm(`Rotacionar a chave de "${endpoint.name}"? Integrações usando a chave atual param de funcionar imediatamente.`)) return
    setBusy(true)
    try { await rotateLeadIntakeEndpointKey(endpoint.id); onChanged() }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível rotacionar a chave.') }
    finally { setBusy(false) }
  }
  const toggleStatus = async () => {
    setBusy(true)
    try { await setLeadIntakeEndpointStatus(endpoint.id, endpoint.status === 'active' ? 'disabled' : 'active'); onChanged() }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível atualizar o status.') }
    finally { setBusy(false) }
  }

  return (
    <div className="card team-member-card">
      <div className="team-member-head">
        <strong>{endpoint.name}</strong>
        <StatusBadge tone={endpoint.status === 'active' ? 'success' : 'neutral'}>{endpoint.status === 'active' ? 'ATIVO' : 'DESATIVADO'}</StatusBadge>
      </div>
      <div className="team-password-row">
        <input readOnly value={leadIntakeFunctionUrl(endpoint.publicKey)} onFocus={(event) => event.currentTarget.select()} />
        <button onClick={copyUrl} type="button"><Copy size={14} />{copied ? 'Copiado' : 'Copiar URL'}</button>
      </div>
      <div className="team-member-facts">
        <span>Eventos recebidos: {endpoint.eventCount}</span>
        <span>Último evento: {endpoint.lastEventAt ? new Date(endpoint.lastEventAt).toLocaleString('pt-BR') : 'nunca'}</span>
        <span>Criado em: {new Date(endpoint.createdAt).toLocaleDateString('pt-BR')}</span>
      </div>
      {canManage && (
        <div className="team-member-actions">
          <SecondaryButton icon={<RefreshCw size={14} />} disabled={busy} onClick={rotate}>Rotacionar chave</SecondaryButton>
          <SecondaryButton icon={endpoint.status === 'active' ? <UserX size={14} /> : <ShieldCheck size={14} />} disabled={busy} onClick={toggleStatus}>
            {endpoint.status === 'active' ? 'Desativar' : 'Reativar'}
          </SecondaryButton>
        </div>
      )}
    </div>
  )
}

function CreateEndpointModal({ close, onCreated }: { close: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) { setError('Dê um nome ao endpoint (ex.: "Site institucional").'); return }
    setSaving(true)
    try { await createLeadIntakeEndpoint(name.trim()); onCreated() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o endpoint.') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={close} eyebrow="ENTRADAS DE LEADS" title="Novo endpoint" footer={<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton disabled={saving} onClick={submit}>{saving ? 'Criando…' : 'Criar endpoint'}</PrimaryButton></>}>
      <div className="team-modal">
        {error && <div className="notice"><span>{error}</span></div>}
        <label className="field">
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder='Ex.: "Site institucional", "Landing Tráfego Pago"' autoFocus />
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
          Crie um endpoint por integração — assim você pode desativar ou rotacionar cada um sem afetar os demais. Veja docs/LEAD_INTAKE_API.md para o formato do payload.
        </p>
      </div>
    </Modal>
  )
}
