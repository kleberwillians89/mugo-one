import { useEffect, useState } from 'react'
import { PageHeader, PrimaryButton, StatusBadge } from '../components/ui'
import { SettingsTabs } from '../components/SettingsTabs'
import { useHasPermission } from '../lib/PermissionsContext'
import { FiscalConnection, OrganizationFiscalProfile, fetchFiscalConnection, fetchOrganizationFiscalProfile, saveOrganizationFiscalProfile } from '../lib/fiscal'
import './TeamSettingsPage.css'

const EMPTY_PROFILE: OrganizationFiscalProfile = {
  stateRegistration: '', municipalRegistration: '', taxRegime: '', addressLine: '', addressNumber: '',
  district: '', city: '', state: '', postalCode: '', cityCode: '', nfseEnabled: false, nfeEnabled: false, nfceEnabled: false, defaultEnvironment: 'sandbox',
}

/**
 * Configurações → Fiscal (briefing §32). tax_regime é só um rótulo
 * configurado pela empresa/contador — o Core nunca lê esse valor para
 * decidir nada (briefing "REGRA FUNDAMENTAL").
 */
export function FiscalSettingsPage() {
  const [profile, setProfile] = useState<OrganizationFiscalProfile>(EMPTY_PROFILE)
  const [connection, setConnection] = useState<FiscalConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const canManage = useHasPermission('fiscal.manage')

  const load = () => {
    Promise.all([fetchOrganizationFiscalProfile(), fetchFiscalConnection()])
      .then(([p, c]) => { if (p) setProfile(p); setConnection(c) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const save = async () => {
    setSaving(true)
    setError('')
    setSavedMessage('')
    try { const saved = await saveOrganizationFiscalProfile(profile); setProfile(saved); setSavedMessage('Perfil fiscal salvo.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil fiscal.') }
    finally { setSaving(false) }
  }

  const field = (key: keyof OrganizationFiscalProfile, label: string) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input value={String(profile[key] ?? '')} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} disabled={!canManage} />
    </label>
  )

  if (loading) return <div className="page"><SettingsTabs active="fiscal"/><p>Carregando…</p></div>

  return (
    <div className="page">
      <SettingsTabs active="fiscal"/>
      <PageHeader eyebrow="CONFIGURAÇÕES" title="Fiscal" description="Dados fiscais da organização, provider e ambiente para emissão de documentos fiscais." />

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-title"><div><h3>Provider</h3><p>Nuvem Fiscal — API atualmente indisponível (serviço descontinuado). Ver documentação técnica.</p></div>
          <StatusBadge tone={connection?.status === 'connected' ? 'success' : 'neutral'}>{connection ? connection.status.toUpperCase() : 'NÃO CONFIGURADO'}</StatusBadge>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-title"><div><h3>Ambiente</h3><p>Nunca emite em produção sem configuração explícita.</p></div>
          <StatusBadge tone={profile.defaultEnvironment === 'production' ? 'danger' : 'warning'}>{profile.defaultEnvironment === 'production' ? 'PRODUÇÃO' : 'SANDBOX'}</StatusBadge>
        </div>
        {canManage && (
          <label className="field">
            <span>Ambiente padrão</span>
            <select
              value={profile.defaultEnvironment}
              onChange={(e) => {
                const next = e.target.value as 'sandbox' | 'production'
                if (next === 'production' && !confirm('Trocar para PRODUÇÃO faz o Mugô One tentar emitir documentos fiscais REAIS. Confirma?')) return
                setProfile({ ...profile, defaultEnvironment: next })
              }}
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Produção</option>
            </select>
          </label>
        )}
      </div>

      <div className="card">
        <div className="card-title"><div><h3>Dados fiscais</h3><p>Razão social e CNPJ já vêm de Configurações gerais — aqui só o que é específico de emissão fiscal.</p></div></div>
        <div className="form-grid">
          {field('stateRegistration', 'Inscrição estadual')}
          {field('municipalRegistration', 'Inscrição municipal')}
          {field('taxRegime', 'Regime tributário (rótulo interno — orientação contábil)')}
          {field('addressLine', 'Endereço')}
          {field('addressNumber', 'Número')}
          {field('district', 'Bairro')}
          {field('city', 'Cidade')}
          {field('state', 'UF')}
          {field('postalCode', 'CEP')}
          {field('cityCode', 'Código IBGE do município')}
        </div>

        <div className="team-flags" style={{ marginTop: 'var(--space-3)' }}>
          <label><input type="checkbox" checked={profile.nfseEnabled} disabled={!canManage} onChange={(e) => setProfile({ ...profile, nfseEnabled: e.target.checked })} /> NFS-e habilitada</label>
          <label><input type="checkbox" checked={profile.nfeEnabled} disabled /> NF-e — em breve</label>
          <label><input type="checkbox" checked={profile.nfceEnabled} disabled /> NFC-e — em breve</label>
        </div>

        {error && <div className="notice" style={{ marginTop: 'var(--space-3)' }}><span>{error}</span></div>}
        {savedMessage && <div className="notice" style={{ marginTop: 'var(--space-3)' }}><span>{savedMessage}</span></div>}
        {canManage && <PrimaryButton loading={saving} onClick={save} style={{ marginTop: 'var(--space-3)' }}>Salvar perfil fiscal</PrimaryButton>}
      </div>
    </div>
  )
}
