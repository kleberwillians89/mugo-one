import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, FormField } from '../components/ui'
import { SettingsTabs } from '../components/SettingsTabs'
import { useHasPermission } from '../lib/PermissionsContext'
import { CommunicationConnection, createEmailConnection, fetchCommunicationConnections } from '../lib/communications'
import './TeamSettingsPage.css'

const CHANNELS: { channel: string; label: string }[] = [
  { channel: 'email', label: 'E-mail' }, { channel: 'whatsapp', label: 'WhatsApp' },
  { channel: 'sms', label: 'SMS' }, { channel: 'instagram', label: 'Instagram' },
]

/**
 * Configurações → Comunicações (briefing §60). Só e-mail tem uma ação
 * real de conectar nesta sprint — os demais mostram "Em breve", sem
 * botão falso de conectar (briefing explícito).
 */
export function CommunicationsSettingsPage() {
  const [connections, setConnections] = useState<CommunicationConnection[] | null>(null)
  const [creating, setCreating] = useState(false)
  const canManage = useHasPermission('communications.manage')

  const load = () => { fetchCommunicationConnections().then(setConnections).catch(() => setConnections([])) }
  useEffect(load, [])

  const statusFor = (channel: string) => connections?.find((c) => c.channel === channel)

  return (
    <div className="page">
      <SettingsTabs active="comunicacoes"/>
      <PageHeader eyebrow="CONFIGURAÇÕES" title="Comunicações" description="Canais que a organização usa para conversar com clientes, contatos e leads." />

      {creating && <CreateEmailConnectionModal close={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}

      <div className="team-grid">
        {CHANNELS.map(({ channel, label }) => {
          const connection = statusFor(channel)
          return (
            <div key={channel} className="card team-member-card">
              <div className="team-member-head">
                <strong>{label}</strong>
                <StatusBadge tone={connection?.status === 'connected' ? 'success' : channel === 'email' ? 'neutral' : 'neutral'}>
                  {connection?.status === 'connected' ? 'CONECTADO' : channel === 'email' ? 'NÃO CONFIGURADO' : 'EM BREVE'}
                </StatusBadge>
              </div>
              {connection?.status === 'connected' && (
                <div className="team-member-facts">
                  <span>{connection.name}</span>
                  <span>{String(connection.configuration.from_email ?? '')}</span>
                </div>
              )}
              {channel === 'email' && !connection && canManage && (
                <PrimaryButton icon={<Plus size={15} />} onClick={() => setCreating(true)}>Conectar e-mail</PrimaryButton>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CreateEmailConnectionModal({ close, onCreated }: { close: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Principal')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!fromEmail.trim() || !fromEmail.includes('@')) return setError('Informe um e-mail de remetente válido.')
    setSaving(true)
    try { await createEmailConnection({ name: name.trim() || 'Principal', fromEmail: fromEmail.trim(), fromName: fromName.trim() || undefined }); onCreated() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível conectar o e-mail.') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={close} eyebrow="COMUNICAÇÕES" title="Conectar e-mail" footer={<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton disabled={saving} onClick={submit}>{saving ? 'Salvando…' : 'Conectar'}</PrimaryButton></>}>
      <div className="team-modal">
        {error && <div className="notice"><span>{error}</span></div>}
        <FormField label="Nome da conexão" htmlFor="connection-name"><input id="connection-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="E-mail de remetente" htmlFor="connection-from-email"><input id="connection-from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="contato@suaempresa.com" /></FormField>
        <FormField label="Nome de exibição (opcional)" htmlFor="connection-from-name"><input id="connection-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} /></FormField>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>A chave de API do provedor de e-mail é configurada pela equipe Mugô diretamente no ambiente — nunca inserida aqui.</p>
      </div>
    </Modal>
  )
}
