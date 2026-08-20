import { FormEvent, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LoaderCircle, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { completeAccountClaim, resolveLoginEmail, startAccountClaim } from '../lib/customer-portal'
import { CustomerPortalApp } from './CustomerPortalApp'
import './customer-portal.css'

const go = (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

function PortalShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="portal-auth">
    <div className="portal-auth-brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><span>Minha RUAH</span></div>
    <div className="portal-auth-card"><h1>{title}</h1><p>{subtitle}</p>{children}</div>
    <small className="portal-auth-safe"><ShieldCheck size={14} /> Seus dados são protegidos</small>
  </main>
}

function ActivateStartPage() {
  const [cpf, setCpf] = useState(''); const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false); const [sent, setSent] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true)
    try { await startAccountClaim(cpf, email) } catch { /* resposta sempre genérica, ver customer-portal.ts */ }
    setSent(true); setLoading(false)
  }
  if (sent) return <PortalShell title="Verifique seu e-mail" subtitle="Se os dados enviados corresponderem a um cadastro existente, você receberá um e-mail com o próximo passo.">
    <button className="portal-link" onClick={() => go('/minha-ruah/login')}>Já tenho senha — entrar</button>
  </PortalShell>
  return <PortalShell title="Ativar Minha RUAH" subtitle="Confirme seus dados para ativar sua área exclusiva.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>CPF</span><input inputMode="numeric" required maxLength={14} value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" /></label>
      <label><span>E-mail cadastrado</span><div><Mail size={16} /><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" /></div></label>
      <button className="portal-submit" disabled={loading || !isSupabaseConfigured}>{loading ? <LoaderCircle className="spin" /> : 'Continuar'}</button>
    </form>
    <button className="portal-link" onClick={() => go('/minha-ruah/login')}>Já tenho senha — entrar</button>
  </PortalShell>
}

function ActivateCompletePage() {
  const [step, setStep] = useState<'loading' | 'password' | 'error'>('loading')
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => {
      const id = data.user?.user_metadata?.ruah_client_account_id as string | undefined
      if (!id) return setStep('error')
      setAccountId(id); setStep('password')
    })
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (password.length < 10) return setError('Use pelo menos 10 caracteres.')
    if (password !== confirm) return setError('As senhas não coincidem.')
    setSaving(true)
    try {
      const { error: updateError } = await supabase!.auth.updateUser({ password })
      if (updateError) throw updateError
      await completeAccountClaim(accountId)
      go('/minha-ruah')
    } catch { setError('Não foi possível concluir. O link pode ter expirado — solicite a ativação novamente.') } finally { setSaving(false) }
  }
  if (step === 'loading') return <PortalShell title="Confirmando seu acesso" subtitle="Aguarde um instante."><LoaderCircle className="spin" /></PortalShell>
  if (step === 'error') return <PortalShell title="Link inválido ou expirado" subtitle="Solicite a ativação novamente."><button className="portal-submit" onClick={() => go('/minha-ruah/ativar-conta')}>Ativar Minha RUAH</button></PortalShell>
  return <PortalShell title="Defina sua senha" subtitle="Crie uma senha para acessar a Minha RUAH sempre que quiser.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>Nova senha</span><div><LockKeyhole size={16} /><input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div></label>
      <label><span>Confirmar senha</span><div><LockKeyhole size={16} /><input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div></label>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : 'Ativar minha conta'}</button>
    </form>
  </PortalShell>
}

function PortalLoginPage() {
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const email = await resolveLoginEmail(identifier)
      const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password })
      // Mesma mensagem genérica para CPF inexistente e para senha errada —
      // nunca revela qual dos dois casos aconteceu.
      if (signInError) setError('CPF/e-mail ou senha incorretos.')
      else go('/minha-ruah')
    } catch { setError('Não foi possível entrar agora. Tente novamente.') } finally { setLoading(false) }
  }
  return <PortalShell title="Minha RUAH" subtitle="Entre para ver seus perfumes e acompanhar seus envios.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>CPF ou e-mail</span><div><UserRound size={16} /><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="000.000.000-00 ou seu@email.com" /></div></label>
      <label><span>Senha</span><div><LockKeyhole size={16} /><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div></label>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={loading || !isSupabaseConfigured}>{loading ? <LoaderCircle className="spin" /> : 'Entrar'}</button>
    </form>
    <button className="portal-link" onClick={() => go('/minha-ruah/ativar-conta')}>Ainda não ativei minha conta</button>
  </PortalShell>
}

export function CustomerPortalRoot() {
  const [path, setPath] = useState(location.pathname)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  useEffect(() => {
    const change = () => setPath(location.pathname)
    addEventListener('popstate', change)
    if (!supabase) return () => removeEventListener('popstate', change)
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => { removeEventListener('popstate', change); data.subscription.unsubscribe() }
  }, [])
  if (!ready) return <div className="portal-loading"><LoaderCircle className="spin" /></div>
  if (path === '/minha-ruah/ativar-conta') return <ActivateStartPage />
  if (path === '/minha-ruah/ativar') return <ActivateCompletePage />
  if (path === '/minha-ruah/login') { if (session) { go('/minha-ruah'); return null } return <PortalLoginPage /> }
  if (!session) { go('/minha-ruah/login'); return null }
  return <CustomerPortalApp path={path} navigate={go} onSignOut={() => supabase!.auth.signOut().then(() => go('/minha-ruah/login'))} />
}
