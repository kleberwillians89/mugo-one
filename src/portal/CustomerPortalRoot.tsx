import { FormEvent, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { completeAccountClaim, finalizeCustomerIdentity, startAccountClaim, startPublicRegistration } from '../lib/customer-portal'
import { CustomerPortalApp } from './CustomerPortalApp'
import './customer-portal.css'

const go = (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const passwordChecks=(value:string)=>({length:value.length>=10,upper:/[A-Z]/.test(value),lower:/[a-z]/.test(value),number:/\d/.test(value),symbol:/[^A-Za-z0-9]/.test(value)})

function PortalShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="portal-auth">
    <div className="portal-auth-brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><strong>RUAH</strong><span>Minha RUAH</span></div>
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
  const [show,setShow]=useState(false)
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => {
      const id = data.user?.user_metadata?.ruah_client_account_id as string | undefined
      const publicRegistration=Boolean(data.user?.user_metadata?.ruah_public_registration)
      if (!id&&!publicRegistration) return setStep('error')
      setAccountId(id??''); setStep('password')
    })
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (!Object.values(passwordChecks(password)).every(Boolean)) return setError('Sua senha ainda não atende a todos os requisitos.')
    if (password !== confirm) return setError('As senhas não coincidem.')
    setSaving(true)
    try {
      const { error: updateError } = await supabase!.auth.updateUser({ password })
      if (updateError) throw updateError
      if(accountId)await completeAccountClaim(accountId)
      go('/minha-ruah/mfa')
    } catch { setError('Não foi possível concluir. O link pode ter expirado — solicite a ativação novamente.') } finally { setSaving(false) }
  }
  if (step === 'loading') return <PortalShell title="Confirmando seu acesso" subtitle="Aguarde um instante."><LoaderCircle className="spin" /></PortalShell>
  if (step === 'error') return <PortalShell title="Link inválido ou expirado" subtitle="Solicite a ativação novamente."><button className="portal-submit" onClick={() => go('/minha-ruah/ativar-conta')}>Ativar Minha RUAH</button></PortalShell>
  return <PortalShell title="Bem-vinda à sua área RUAH." subtitle="Seu acesso está pronto. Crie sua senha para acompanhar perfumes, pedidos, custódia e envios de forma privada.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>Crie sua senha</span><div><LockKeyhole size={16} /><input type={show?'text':'password'} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="portal-password-toggle" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
      <label><span>Confirmar senha</span><div><LockKeyhole size={16} /><input type={show?'text':'password'} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div></label>
      <div className="portal-password-requirements">{Object.entries({length:'10 caracteres',upper:'Letra maiúscula',lower:'Letra minúscula',number:'Número',symbol:'Caractere especial'}).map(([key,label])=><span className={passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>]?'met':''} key={key}>{passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>]?'✓':'○'} {label}</span>)}</div>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : 'Criar meu acesso'}</button>
    </form>
  </PortalShell>
}

function RegistrationPage(){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[loading,setLoading]=useState(false),[sent,setSent]=useState(false)
  const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);try{await startPublicRegistration(name,email,phone)}catch{/* resposta externa permanece neutra */}finally{setSent(true);setLoading(false)}}
  if(sent)return <PortalShell title="Vamos confirmar seus dados para continuar." subtitle="Se o cadastro puder prosseguir, você receberá um e-mail com o próximo passo."><button className="portal-submit" onClick={()=>go('/minha-ruah/login')}>Voltar para entrar</button></PortalShell>
  return <PortalShell title="Crie seu acesso." subtitle="Tenha sua relação com a RUAH reunida em um único espaço privado."><form className="portal-form" onSubmit={submit}>
    <label><span>Nome completo</span><div><UserRound/><input autoComplete="name" required minLength={3} value={name} onChange={event=>setName(event.target.value)}/></div></label>
    <label><span>E-mail</span><div><Mail/><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></div></label>
    <label><span>WhatsApp</span><div><Phone/><input inputMode="tel" autoComplete="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></div></label>
    <p className="portal-legal">Ao continuar, consulte nosso <a href="/minha-ruah/privacidade">Aviso de Privacidade</a> e os <a href="/minha-ruah/termos">Termos de Uso</a>. A criação da conta não autoriza mensagens promocionais.</p>
    <button className="portal-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Continuar'}</button>
  </form></PortalShell>
}

function RecoveryPage(){
  const [email,setEmail]=useState(''),[sent,setSent]=useState(false),[loading,setLoading]=useState(false)
  const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);await supabase?.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/minha-ruah/ativar`});setSent(true);setLoading(false)}
  return <PortalShell title="Recuperar meu acesso" subtitle={sent?'Se existir um acesso vinculado a este e-mail, você receberá as instruções para continuar.':'Informe seu e-mail para receber instruções seguras.'}>{!sent&&<form className="portal-form" onSubmit={submit}><label><span>E-mail</span><div><Mail/><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></div></label><button className="portal-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Enviar instruções'}</button></form>}<button className="portal-link" onClick={()=>go('/minha-ruah/login')}>Voltar para entrar</button></PortalShell>
}

function LegalPage({terms=false}:{terms?:boolean}){return <PortalShell title={terms?'Termos de Uso':'Aviso de Privacidade'} subtitle={terms?'Condições para utilizar seu espaço privado Minha RUAH.':'Como protegemos os dados usados para oferecer seu espaço privado.'}><div className="portal-legal-copy">{terms?<><p>O Minha RUAH oferece acesso pessoal ao seu relacionamento com a RUAH. Seu acesso não deve ser compartilhado.</p><p>As informações exibidas refletem os registros operacionais vinculados com segurança à sua conta.</p></>:<><p>Utilizamos seus dados de identificação e contato para proteger o acesso, localizar com segurança seu cadastro e prestar os serviços solicitados.</p><p>A criação da conta não representa consentimento para marketing. Preferências comerciais são tratadas separadamente.</p></>}</div><button className="portal-link" onClick={()=>go('/minha-ruah/cadastro')}>Voltar ao cadastro</button></PortalShell>}

function MfaPage({onReady}:{onReady:(review:boolean)=>void}){
  const [factorId,setFactorId]=useState(''),[challengeId,setChallengeId]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  useEffect(()=>{const prepare=async()=>{try{const {data:user}=await supabase!.auth.getUser(),phone=String(user.user?.user_metadata?.phone??'');if(!phone)throw new Error('MFA_PROVIDER_NOT_CONFIGURED');const listed=await supabase!.auth.mfa.listFactors();let id=listed.data?.phone?.find(item=>item.status==='verified')?.id??listed.data?.phone?.[0]?.id;if(!id){const enrolled=await supabase!.auth.mfa.enroll({factorType:'phone',phone});if(enrolled.error)throw enrolled.error;id=enrolled.data.id}setFactorId(id);const challenged=await supabase!.auth.mfa.challenge({factorId:id});if(challenged.error)throw challenged.error;setChallengeId(challenged.data.id)}catch(reason){const message=reason instanceof Error?reason.message:'';setError(/phone|provider|unsupported|disabled/i.test(message)?'MFA_PROVIDER_NOT_CONFIGURED':'Não foi possível iniciar a verificação.')}finally{setLoading(false)}};prepare()},[])
  const verify=async(event:FormEvent)=>{event.preventDefault();setLoading(true);setError('');const result=await supabase!.auth.mfa.verify({factorId,challengeId,code});if(result.error){setError('Código inválido ou expirado.');setLoading(false);return}try{const status=await finalizeCustomerIdentity();onReady(status==='review_required')}catch(reason){if(!String(reason).includes('identity_request_not_found'))onReady(true);else onReady(false)}finally{setLoading(false)}}
  return <PortalShell title="Proteja seu espaço privado." subtitle="Enviamos um código ao telefone confirmado para ativar o segundo fator.">{loading?<LoaderCircle className="spin"/>:<>{error&&<div className="portal-error">{error}</div>}{!error&&<form className="portal-form" onSubmit={verify}><label><span>Código de segurança</span><input inputMode="numeric" autoComplete="one-time-code" required minLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))}/></label><button className="portal-submit">Confirmar código</button></form>}</>}</PortalShell>
}

function PortalLoginPage() {
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [show,setShow]=useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const { error: signInError } = await supabase!.auth.signInWithPassword({ email:identifier.trim(), password })
      // Mesma mensagem genérica para CPF inexistente e para senha errada —
      // nunca revela qual dos dois casos aconteceu.
      if (signInError) setError('E-mail ou senha incorretos.')
      else go('/minha-ruah')
    } catch { setError('Não foi possível entrar agora. Tente novamente.') } finally { setLoading(false) }
  }
  return <PortalShell title="Bem-vinda ao seu espaço privado." subtitle="Acompanhe seus perfumes, custódia, pedidos e envios.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>E-mail</span><div><Mail size={16} /><input type="email" autoComplete="email" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="seu@email.com" /></div></label>
      <label><span>Senha</span><div><LockKeyhole size={16} /><input type={show?'text':'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="portal-password-toggle" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={loading || !isSupabaseConfigured}>{loading ? <LoaderCircle className="spin" /> : 'Entrar'}</button>
    </form>
    <button className="portal-link" onClick={()=>go('/minha-ruah/cadastro')}>Criar meu acesso</button>
    <button className="portal-link" onClick={()=>go('/minha-ruah/recuperar')}>Esqueci minha senha</button>
  </PortalShell>
}

export function CustomerPortalRoot() {
  const [path, setPath] = useState(location.pathname)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const [aal,setAal]=useState<'aal1'|'aal2'|null>(null),[review,setReview]=useState(false)
  useEffect(() => {
    const change = () => setPath(location.pathname)
    addEventListener('popstate', change)
    if (!supabase) return () => removeEventListener('popstate', change)
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => { removeEventListener('popstate', change); data.subscription.unsubscribe() }
  }, [])
  if (!ready) return <div className="portal-loading"><LoaderCircle className="spin" /></div>
  if(path==='/minha-ruah/cadastro')return <RegistrationPage/>
  if(path==='/minha-ruah/recuperar')return <RecoveryPage/>
  if(path==='/minha-ruah/privacidade')return <LegalPage/>
  if(path==='/minha-ruah/termos')return <LegalPage terms/>
  if (path === '/minha-ruah/ativar-conta') return <ActivateStartPage />
  if (path === '/minha-ruah/ativar') return <ActivateCompletePage />
  if (path === '/minha-ruah/login') { if (session) { go('/minha-ruah'); return null } return <PortalLoginPage /> }
  if (!session) { go('/minha-ruah/login'); return null }
  if(review)return <PortalShell title="Estamos finalizando seu acesso." subtitle="Para proteger seus dados, precisamos confirmar algumas informações antes de vincular seu histórico. A equipe RUAH foi avisada."><button className="portal-submit" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/login'))}>Voltar</button></PortalShell>
  if(aal===null){supabase!.auth.mfa.getAuthenticatorAssuranceLevel().then(({data})=>setAal(data?.currentLevel==='aal2'?'aal2':'aal1'));return <div className="portal-loading"><LoaderCircle className="spin"/></div>}
  if(path==='/minha-ruah/mfa'||aal!=='aal2')return <MfaPage onReady={(needsReview)=>{if(needsReview)setReview(true);else{setAal('aal2');go('/minha-ruah')}}}/>
  return <CustomerPortalApp path={path} navigate={go} onSignOut={() => supabase!.auth.signOut().then(() => go('/minha-ruah/login'))} />
}
