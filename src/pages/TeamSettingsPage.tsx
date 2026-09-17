import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, ShieldCheck, UserX } from 'lucide-react'
import { Modal, PageHeader, PrimaryButton, SecondaryButton, Select, StatusBadge } from '../components/ui'
import { useHasPermission } from '../lib/PermissionsContext'
import {
  PERMISSION_CATALOG, PERMISSION_MODULE_LABEL, PRESET_DEFAULT_FLAGS, PRESET_LABEL, Preset, isValidUsername,
} from '../lib/permissions'
import {
  TeamMember, createTeamMember, fetchTeamMemberPermissions, fetchTeamMembers, generatePassword,
  resetTeamMemberPassword, setTeamMemberStatus, updateTeamMemberPermissions,
} from '../lib/team'
import './TeamSettingsPage.css'

function goToSettings(sub: '' | 'equipe') {
  history.pushState({}, '', sub ? `/configuracoes/${sub}` : '/configuracoes')
  dispatchEvent(new PopStateEvent('popstate'))
}

const MODULE_ORDER = Array.from(new Set(PERMISSION_CATALOG.map((entry) => entry.module)))

function moduleGroups() {
  return MODULE_ORDER.map((module) => ({ module, label: PERMISSION_MODULE_LABEL[module] ?? module, items: PERMISSION_CATALOG.filter((entry) => entry.module === module) }))
}

/**
 * Configurações → Equipe e acessos (briefing inteiro deste módulo). Duas
 * abas simples no topo (Frete/Equipe) — a página de Frete já existe
 * (ShippingSettingsPage) e continua intocada, só ganhou uma vizinha.
 */
export function TeamSettingsPage() {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null)
  const canManage = useHasPermission('team.manage')

  const load = () => {
    fetchTeamMembers().then(setMembers).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a equipe.')).finally(() => setLoading(false))
  }
  const reload = () => { setLoading(true); load() }
  useEffect(load, [])

  return (
    <div className="page">
      <div className="team-tabs">
        <button onClick={() => goToSettings('')}>Frete</button>
        <button className="active">Equipe e acessos</button>
      </div>
      <PageHeader eyebrow="CONFIGURAÇÕES" title="Equipe e acessos" description="Quem entra no Mugô One e o que cada pessoa pode ver, criar, editar e operar." actions={canManage ? <PrimaryButton icon={<Plus size={17} />} onClick={() => setEditing('new')}>Novo usuário</PrimaryButton> : undefined}/>

      {editing && (
        <TeamMemberModal
          member={editing === 'new' ? null : editing}
          allMembers={members ?? []}
          close={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}

      {error && <div className="notice"><span>{error}</span></div>}
      {loading ? <p>Carregando…</p> : (
        <div className="team-grid">
          {(members ?? []).map((member) => (
            <TeamMemberCard key={member.user_id} member={member} canManage={canManage} onEdit={() => setEditing(member)} onStatusChanged={reload} />
          ))}
          {members?.length === 0 && <div className="empty card"><h3>Nenhum usuário além de você</h3><p>Cadastre a primeira pessoa da equipe.</p></div>}
        </div>
      )}
    </div>
  )
}

function TeamMemberCard({ member, canManage, onEdit, onStatusChanged }: { member: TeamMember; canManage: boolean; onEdit: () => void; onStatusChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const toggleStatus = async () => {
    setBusy(true)
    try { await setTeamMemberStatus(member.user_id, member.status === 'active' ? 'inactive' : 'active'); onStatusChanged() }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível atualizar o status.') }
    finally { setBusy(false) }
  }
  return (
    <div className="card team-member-card">
      <div className="team-member-head">
        <strong>{member.full_name}</strong>
        <StatusBadge tone={member.status === 'active' ? 'success' : 'neutral'}>{member.status === 'active' ? 'ATIVO' : 'INATIVO'}</StatusBadge>
      </div>
      <span className="team-member-username">@{member.email.split('@')[0]}</span>
      <span className="team-member-preset">{PRESET_LABEL[member.permission_preset]}</span>
      <div className="team-member-facts">
        <span>Ver tudo: {member.view_all || member.access_total ? 'SIM' : 'NÃO'}</span>
        {member.permission_overrides > 0 && <span>Permissões especiais: {member.permission_overrides}</span>}
      </div>
      {canManage && (
        <div className="team-member-actions">
          <SecondaryButton onClick={onEdit}>Editar</SecondaryButton>
          <SecondaryButton icon={member.status === 'active' ? <UserX size={14} /> : <ShieldCheck size={14} />} disabled={busy} onClick={toggleStatus}>
            {member.status === 'active' ? 'Desativar' : 'Reativar'}
          </SecondaryButton>
        </div>
      )}
    </div>
  )
}

function TeamMemberModal({ member, allMembers, close, onSaved }: { member: TeamMember | null; allMembers: TeamMember[]; close: () => void; onSaved: () => void }) {
  const isNew = member === null
  const [displayName, setDisplayName] = useState(member?.full_name ?? '')
  const [username, setUsername] = useState(isNew ? '' : (member!.email.includes('@acesso.') ? member!.email.split('@')[0] : member!.email))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [preset, setPreset] = useState<Preset>(member?.permission_preset ?? 'comercial')
  const [viewAll, setViewAll] = useState(member?.view_all ?? PRESET_DEFAULT_FLAGS.comercial.viewAll)
  const [accessTotal, setAccessTotal] = useState(member?.access_total ?? PRESET_DEFAULT_FLAGS.comercial.accessTotal)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [showCustom, setShowCustom] = useState(false)
  const [copyFrom, setCopyFrom] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (member) fetchTeamMemberPermissions(member.user_id).then(setChecked).catch(() => {})
  }, [member])

  const applyPresetDefaults = (next: Preset) => {
    setPreset(next)
    setViewAll(PRESET_DEFAULT_FLAGS[next].viewAll)
    setAccessTotal(PRESET_DEFAULT_FLAGS[next].accessTotal)
  }

  const toggle = (code: string) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })
  const markAll = () => setChecked(new Set(PERMISSION_CATALOG.map((entry) => entry.code)))
  const onlyView = () => setChecked(new Set(PERMISSION_CATALOG.filter((entry) => entry.code.endsWith('.view')).map((entry) => entry.code)))
  const clearAll = () => setChecked(new Set())

  const applyCopyFrom = async (userId: string) => {
    setCopyFrom(userId)
    if (!userId) return
    const source = allMembers.find((candidate) => candidate.user_id === userId)
    if (!source) return
    setPreset(source.permission_preset)
    setViewAll(source.view_all)
    setAccessTotal(source.access_total)
    setChecked(await fetchTeamMemberPermissions(userId).catch(() => new Set<string>()))
    setShowCustom(true)
  }

  const generate = () => { const value = generatePassword(); setPassword(value); setShowPassword(true) }
  const copyPassword = () => navigator.clipboard?.writeText(password).catch(() => {})

  const submit = async () => {
    setError('')
    if (!displayName.trim()) return setError('Informe o nome.')
    const overrides = PERMISSION_CATALOG.map((entry) => ({ code: entry.code, granted: checked.has(entry.code) }))
    setSaving(true)
    try {
      if (isNew) {
        if (!isValidUsername(username)) throw new Error('Usuário inválido. Use letras minúsculas, números, ponto, underline ou hífen (3-32 caracteres).')
        if (password.length < 10) throw new Error('A senha precisa ter pelo menos 10 caracteres.')
        await createTeamMember({ username, displayName: displayName.trim(), password, preset, viewAll, accessTotal, overrides })
      } else {
        await updateTeamMemberPermissions({ targetUserId: member!.user_id, preset, viewAll, accessTotal, overrides })
      }
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const submitReset = async () => {
    if (newPassword.length < 10) return setError('A senha precisa ter pelo menos 10 caracteres.')
    setSaving(true); setError('')
    try { await resetTeamMemberPassword(member!.user_id, newPassword); setResetOpen(false); setNewPassword('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível redefinir a senha.') }
    finally { setSaving(false) }
  }

  const otherMembers = useMemo(() => allMembers.filter((candidate) => candidate.user_id !== member?.user_id), [allMembers, member])

  return (
    <Modal open onClose={close} size="lg" eyebrow="EQUIPE E ACESSOS" title={isNew ? 'Novo usuário' : `Editar ${member!.full_name}`} footer={
      <>
        <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
        <PrimaryButton loading={saving} onClick={submit}>{isNew ? 'Cadastrar usuário' : 'Salvar alterações'}</PrimaryButton>
      </>
    }>
      <div className="team-modal">
        <div className="form-grid">
          <label className="field"><span>Nome</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Davi" /></label>
          <label className="field"><span>Usuário</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="davi.vendas" disabled={!isNew} /></label>
        </div>

        {isNew ? (
          <div className="form-grid">
            <label className="field wide">
              <span>Senha</span>
              <div className="team-password-row">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 10 caracteres" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button type="button" onClick={generate}>Gerar</button>
                {password && <button type="button" onClick={copyPassword}><Copy size={14} /> Copiar</button>}
              </div>
              <small>A senha só aparece agora. Depois de salvar, só é possível redefinir.</small>
            </label>
          </div>
        ) : (
          <div className="team-reset-row">
            {resetOpen ? (
              <div className="team-password-row">
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nova senha (mínimo 10 caracteres)" />
                <button type="button" onClick={() => { setNewPassword(generatePassword()) }}>Gerar</button>
                <PrimaryButton loading={saving} onClick={submitReset}>Confirmar</PrimaryButton>
                <SecondaryButton onClick={() => setResetOpen(false)}>Cancelar</SecondaryButton>
              </div>
            ) : <SecondaryButton icon={<RefreshCw size={14} />} onClick={() => setResetOpen(true)}>Redefinir senha</SecondaryButton>}
          </div>
        )}

        <Select label="Perfil" value={preset} onChange={(value) => applyPresetDefaults(value as Preset)} options={Object.entries(PRESET_LABEL).map(([value, label]) => ({ value, label }))} />

        <div className="team-flags">
          <label><input type="checkbox" checked={viewAll} onChange={(event) => setViewAll(event.target.checked)} /> Ver tudo</label>
          <label><input type="checkbox" checked={accessTotal} onChange={(event) => setAccessTotal(event.target.checked)} /> Acesso total</label>
        </div>

        {otherMembers.length > 0 && (
          <label className="field"><span>Copiar acessos de</span>
            <select value={copyFrom} onChange={(event) => applyCopyFrom(event.target.value)}>
              <option value="">Selecionar…</option>
              {otherMembers.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.full_name}</option>)}
            </select>
          </label>
        )}

        <button type="button" className="team-custom-toggle" onClick={() => setShowCustom((value) => !value)}>
          {showCustom ? 'Ocultar permissões personalizadas' : 'Personalizar permissões'}
        </button>

        {showCustom && (
          <div className="team-permission-groups">
            <div className="team-shortcuts">
              <SecondaryButton onClick={markAll}>Marcar tudo</SecondaryButton>
              <SecondaryButton onClick={onlyView}>Somente visualização</SecondaryButton>
              <SecondaryButton onClick={clearAll}>Limpar</SecondaryButton>
            </div>
            {moduleGroups().map((group) => (
              <div className="team-permission-card" key={group.module}>
                <strong>{group.label}</strong>
                <div className="team-permission-list">
                  {group.items.map((entry) => (
                    <label key={entry.code}>
                      <input type="checkbox" checked={checked.has(entry.code)} onChange={() => toggle(entry.code)} />
                      {checked.has(entry.code) && <Check size={12} />}
                      {entry.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
