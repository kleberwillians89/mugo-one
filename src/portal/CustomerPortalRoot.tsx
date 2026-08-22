import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { initialInviteCallback, isSupabaseConfigured, supabase } from '../lib/supabase'
import { completeAccountClaim, finalizeCustomerIdentity, hasValidFirstAccessContext, startAccountClaim, startPublicRegistration } from '../lib/customer-portal'
import { recordMfaProviderUnavailable } from '../lib/mfa-diagnostics'
import { publicEnv } from '../lib/publicEnv'
import { CustomerPortalApp } from './CustomerPortalApp'
import { createRecoveryConfirmation } from './recovery-confirmation'
import { hasValidRecoverySession } from './recovery-session'
import {removeAuthSecretsFromUrl,resolveInviteSession} from './first-access-callback'
import './customer-portal.css'

const go = (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const passwordChecks=(value:string)=>({length:value.length>=10,upper:/[A-Z]/.test(value),lower:/[a-z]/.test(value),number:/\d/.test(value),symbol:/[^A-Za-z0-9]/.test(value)})

function PortalShell({ title, subtitle, children, safeCopy='Seus dados são protegidos' }: { title: string; subtitle: string; children: React.ReactNode;safeCopy?:string }) {
  return <main className="portal-auth">
    <div className="portal-auth-brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><strong>RUAH</strong><span>Minha RUAH</span></div>
    <div className="portal-auth-card"><h1>{title}</h1><p>{subtitle}</p>{children}</div>
    <small className="portal-auth-safe"><ShieldCheck size={14} /> {safeCopy}</small>
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
    <button className="portal-link" onClick={() => go('/minha-ruah/entrar')}>Já tenho senha — entrar</button>
  </PortalShell>
  return <PortalShell title="Ativar Minha RUAH" subtitle="Confirme seus dados para ativar sua área exclusiva.">
    <form className="portal-form" onSubmit={submit}>
      <label><span>CPF</span><input inputMode="numeric" required maxLength={14} value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" /></label>
      <label><span>E-mail cadastrado</span><div><Mail size={16} /><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" /></div></label>
      <button className="portal-submit" disabled={loading || !isSupabaseConfigured}>{loading ? <LoaderCircle className="spin" /> : 'Continuar'}</button>
    </form>
    <button className="portal-link" onClick={() => go('/minha-ruah/entrar')}>Já tenho senha — entrar</button>
  </PortalShell>
}

function ActivateCompletePage({recovery=false}:{recovery?:boolean}) {
  const [step, setStep] = useState<'loading' | 'password' | 'success' | 'error'>('loading')
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('')
  const [show,setShow]=useState(false)
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const processing=useRef(false)
  useEffect(() => {
    if(processing.current)return
    processing.current=true
    if(recovery){
      hasValidRecoverySession(supabase!.auth).then(valid=>setStep(valid?'password':'error'))
      return
    }
    resolveInviteSession(supabase!.auth,initialInviteCallback).then(async(session)=>{
      if(!session){setStep('error');return}
      const {data,error:userError}=await supabase!.auth.getUser()
      if(userError||!data.user){setStep('error');return}
      const id = data.user?.user_metadata?.ruah_client_account_id as string | undefined
      const publicRegistration=Boolean(data.user?.user_metadata?.ruah_public_registration)
      if (!recovery&&!id&&!publicRegistration) return setStep('error')
      if(!await hasValidFirstAccessContext())return setStep('error')
      removeAuthSecretsFromUrl();setAccountId(id??'');setStep('password')
    })
  }, [recovery])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (!Object.values(passwordChecks(password)).every(Boolean)) return setError('Sua senha ainda não atende a todos os requisitos.')
    if (password !== confirm) return setError('As senhas não coincidem.')
    setSaving(true)
    try {
      const { error: updateError } = await supabase!.auth.updateUser({ password })
      if (updateError) throw updateError
      if(!recovery&&accountId)await completeAccountClaim(accountId)
      setStep('success')
    } catch { setError('Não foi possível criar sua senha. Solicite um novo link e tente novamente.') } finally { setSaving(false) }
  }
  if (step === 'loading') return <PortalShell title="Confirmando seu acesso" subtitle="Aguarde um instante."><LoaderCircle className="spin" /></PortalShell>
  if (step === 'error') return <PortalShell title={recovery?'Este link de recuperação não é mais válido.':'Este link não é mais válido.'} subtitle="Ele pode ter expirado, já ter sido utilizado ou estar incompleto."><button className="portal-submit" onClick={() => go(recovery?'/minha-ruah/recuperar':'/minha-ruah/ativar-conta')}>{recovery?'SOLICITAR NOVO LINK':'SOLICITAR NOVO LINK'}</button><button className="portal-link" onClick={()=>go('/minha-ruah/entrar')}>VOLTAR PARA ENTRAR</button></PortalShell>
  if(step==='success')return <PortalShell title={recovery?'Sua senha foi redefinida com sucesso.':'Senha criada com sucesso.'} subtitle="Seu acesso está protegido e pronto para os próximos logins."><button className="portal-submit" onClick={()=>go('/minha-ruah')}>ENTRAR NO MINHA RUAH</button></PortalShell>
  return <PortalShell title={recovery?'Defina sua nova senha':'Crie sua senha'} subtitle={recovery?'Escolha uma nova senha forte para recuperar seu acesso.':'Crie uma senha forte para acessar seu espaço privado agora e nos próximos logins.'}>
    <form className="portal-form" onSubmit={submit}>
      <label><span>Nova senha</span><div><LockKeyhole size={16} /><input type={show?'text':'password'} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="portal-password-toggle" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
      <label><span>Confirmar nova senha</span><div><LockKeyhole size={16} /><input type={show?'text':'password'} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div></label>
      <div className="portal-password-requirements">{Object.entries({length:'10 caracteres',upper:'Letra maiúscula',lower:'Letra minúscula',number:'Número',symbol:'Caractere especial'}).map(([key,label])=><span className={passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>]?'met':''} key={key}>{passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>]?'✓':'○'} {label}</span>)}</div>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : recovery?'REDEFINIR SENHA':'CRIAR MINHA SENHA'}</button>
    </form>
  </PortalShell>
}

function RegistrationPage(){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[loading,setLoading]=useState(false),[sentTo,setSentTo]=useState(''),[error,setError]=useState(''),[seconds,setSeconds]=useState(0)
  useEffect(()=>{if(seconds<=0)return;const timer=window.setTimeout(()=>setSeconds(value=>value-1),1000);return()=>window.clearTimeout(timer)},[seconds])
  const send=async()=>{setLoading(true);setError('');try{const result=await startPublicRegistration(name,email,phone);if(result.status!=='invite_sent')throw new Error('Não foi possível confirmar o envio.');setSentTo(result.email);setSeconds(60)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível enviar o convite. Tente novamente.')}finally{setLoading(false)}}
  const submit=async(event:FormEvent)=>{event.preventDefault();await send()}
  if(sentTo)return <PortalShell title="Link enviado para seu e-mail." subtitle="Enviamos as instruções para você criar sua senha e ativar seu acesso ao Minha RUAH." safeCopy={`Enviamos um link para: ${sentTo}`}><div className="portal-success-copy"><p>Abra sua caixa de entrada e clique em “CRIAR MINHA SENHA”.</p><p>Não encontrou a mensagem? Confira também Spam, Lixo eletrônico e Promoções.</p></div>{error&&<div className="portal-error">{error}</div>}<button className="portal-submit" disabled={loading||seconds>0} onClick={send}>{loading?<LoaderCircle className="spin"/>:seconds>0?`REENVIAR LINK EM ${seconds}S`:'REENVIAR LINK'}</button><button className="portal-link" onClick={()=>go('/minha-ruah/entrar')}>VOLTAR PARA ENTRAR</button></PortalShell>
  return <PortalShell title="Crie seu acesso." subtitle="Tenha sua relação com a RUAH reunida em um único espaço privado."><form className="portal-form" onSubmit={submit}>
    <label><span>Nome completo</span><div><UserRound/><input autoComplete="name" required minLength={3} value={name} onChange={event=>setName(event.target.value)}/></div></label>
    <label><span>E-mail</span><div><Mail/><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></div></label>
    <label><span>WhatsApp</span><div><Phone/><input inputMode="tel" autoComplete="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></div></label>
    <p className="portal-legal">Ao continuar, consulte nosso <a href="/minha-ruah/privacidade">Aviso de Privacidade</a> e os <a href="/minha-ruah/termos">Termos de Uso</a>. A criação da conta não autoriza mensagens promocionais.</p>
    {error&&<div className="portal-error">{error}</div>}
    <button className="portal-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Continuar'}</button>
  </form></PortalShell>
}

function RecoveryPage(){
  const [email,setEmail]=useState(''),[sent,setSent]=useState(false),[loading,setLoading]=useState(false)
  const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);await supabase?.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/minha-ruah/redefinir-senha`});setSent(true);setLoading(false)}
  return <PortalShell title="Recuperar meu acesso" subtitle={sent?'Se existir um acesso vinculado a este e-mail, você receberá as instruções para continuar.':'Informe seu e-mail para receber instruções seguras.'}>{!sent&&<form className="portal-form" onSubmit={submit}><label><span>E-mail</span><div><Mail/><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></div></label><button className="portal-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Enviar instruções'}</button></form>}<button className="portal-link" onClick={()=>go('/minha-ruah/entrar')}>Voltar para entrar</button></PortalShell>
}

function RecoveryConfirmationPage(){
  const tokenHash=new URLSearchParams(location.search).get('token_hash')?.trim()??''
  const confirmation=useMemo(()=>supabase?createRecoveryConfirmation(supabase.auth,tokenHash):null,[tokenHash])
  const [step,setStep]=useState<'ready'|'loading'|'error'>(tokenHash?'ready':'error')
  const continueRecovery=async()=>{
    if(step!=='ready'||!confirmation)return
    setStep('loading')
    const result=await confirmation()
    if(result==='verified'){go('/minha-ruah/redefinir-senha?flow=recovery');return}
    if(result==='invalid')setStep('error')
  }
  if(step==='error')return <PortalShell title="Este link de recuperação não é mais válido." subtitle="Ele pode ter expirado, já ter sido utilizado ou estar incompleto."><button className="portal-submit" onClick={()=>go('/minha-ruah/recuperar')}>SOLICITAR NOVO LINK</button><button className="portal-link" onClick={()=>go('/minha-ruah/entrar')}>VOLTAR PARA ENTRAR</button></PortalShell>
  return <PortalShell title="Redefina sua senha" subtitle="Para sua segurança, confirme que deseja continuar. O link só será validado após o clique."><button className="portal-submit" disabled={step==='loading'} onClick={continueRecovery}>{step==='loading'?<LoaderCircle className="spin"/>:'CONTINUAR E REDEFINIR SENHA'}</button><button className="portal-link" disabled={step==='loading'} onClick={()=>go('/minha-ruah/entrar')}>VOLTAR PARA ENTRAR</button></PortalShell>
}

function LegalPage({terms=false}:{terms?:boolean}){return <PortalShell title={terms?'Termos de Uso':'Aviso de Privacidade'} subtitle={terms?'Condições para utilizar seu espaço privado Minha RUAH.':'Como protegemos os dados usados para oferecer seu espaço privado.'}><div className="portal-legal-copy">{terms?<><p>O Minha RUAH oferece acesso pessoal ao seu relacionamento com a RUAH. Seu acesso não deve ser compartilhado.</p><p>As informações exibidas refletem os registros operacionais vinculados com segurança à sua conta.</p></>:<><p>Utilizamos seus dados de identificação e contato para proteger o acesso, localizar com segurança seu cadastro e prestar os serviços solicitados.</p><p>A criação da conta não representa consentimento para marketing. Preferências comerciais são tratadas separadamente.</p></>}</div><button className="portal-link" onClick={()=>go('/minha-ruah/cadastro')}>Voltar ao cadastro</button></PortalShell>}

type MfaStep='loading'|'phone'|'sending'|'code'|'verifying'|'unavailable'|'rate_limit'|'unexpected'
const brPhone=(value:string)=>{const digits=value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'').slice(0,11);return digits.length>10?`(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`:digits.length>6?`(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`:digits.length>2?`(${digits.slice(0,2)}) ${digits.slice(2)}`:digits}
const e164=(value:string)=>{const digits=value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');return digits.length===10||digits.length===11?`+55${digits}`:''}
const maskedPhone=(value:string)=>{const digits=value.replace(/\D/g,'');return digits.length>=4?`•••••-${digits.slice(-4)}`:'seu celular'}
const mfaErrorKind=(reason:unknown):MfaStep=>{const value=`${(reason as {code?:string})?.code??''} ${reason instanceof Error?reason.message:''}`.toLowerCase();if(/rate|too.many|over_request/.test(value))return'rate_limit';if(/provider|unsupported|disabled|phone.*not.*enabled|sms.*not/.test(value))return'unavailable';return'unexpected'}
const recordMfaFailure=(reason:unknown)=>{const kind=mfaErrorKind(reason);if(kind==='unavailable')recordMfaProviderUnavailable();return kind}

function MfaPage({onReady}:{onReady:(review:boolean)=>void}){
  const[step,setStep]=useState<MfaStep>('loading'),[factorId,setFactorId]=useState(''),[challengeId,setChallengeId]=useState(''),[phone,setPhone]=useState(''),[sentTo,setSentTo]=useState(''),[code,setCode]=useState(''),[codeError,setCodeError]=useState(''),[seconds,setSeconds]=useState(60)
  const challenge=async(id:string,destination:string)=>{setStep('sending');const result=await supabase!.auth.mfa.challenge({factorId:id});if(result.error){setStep(recordMfaFailure(result.error));return}setFactorId(id);setChallengeId(result.data.id);setSentTo(destination);setCode('');setCodeError('');setSeconds(60);setStep('code')}
  const bootstrap=async()=>{setStep('loading');try{const{data}=await supabase!.auth.getUser();const metadataPhone=String(data.user?.user_metadata?.phone??'');const listed=await supabase!.auth.mfa.listFactors();if(listed.error)throw listed.error;const existing=listed.data.phone?.find(item=>item.status==='verified')??listed.data.phone?.[0];if(existing){await challenge(existing.id,metadataPhone);return}if(metadataPhone)setPhone(brPhone(metadataPhone));setStep('phone')}catch(reason){setStep(recordMfaFailure(reason))}}
  useEffect(()=>{const timer=window.setTimeout(()=>{void bootstrap()},0);return()=>window.clearTimeout(timer)},[]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(step!=='code'||seconds<=0)return;const timer=window.setTimeout(()=>setSeconds(value=>value-1),1000);return()=>window.clearTimeout(timer)},[step,seconds])
  const send=async(event?:FormEvent)=>{event?.preventDefault();const normalized=e164(phone);if(!normalized){setCodeError('Informe um celular brasileiro válido.');return}setCodeError('');setStep('sending');try{const listed=await supabase!.auth.mfa.listFactors();const pending=listed.data?.phone?.find(item=>item.status!=='verified');if(pending)await supabase!.auth.mfa.unenroll({factorId:pending.id});const enrolled=await supabase!.auth.mfa.enroll({factorType:'phone',phone:normalized});if(enrolled.error)throw enrolled.error;await challenge(enrolled.data.id,normalized)}catch(reason){setStep(recordMfaFailure(reason))}}
  const resend=async()=>{if(seconds>0)return;if(factorId)await challenge(factorId,sentTo);else await send()}
  const verify=async(event:FormEvent)=>{event.preventDefault();if(code.length!==6){setCodeError('Digite os 6 números enviados ao seu celular.');return}setStep('verifying');setCodeError('');const result=await supabase!.auth.mfa.verify({factorId,challengeId,code});if(result.error){const raw=`${result.error.code??''} ${result.error.message}`.toLowerCase();if(/expired/.test(raw))setCodeError('Esse código expirou. Solicite um novo para continuar.');else if(/rate|too.many/.test(raw)){setStep('rate_limit');return}else setCodeError('Esse código não confere. Verifique e tente novamente.');setStep('code');return}const assurance=await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.data?.currentLevel!=='aal2'){setStep('unexpected');return}try{const status=await finalizeCustomerIdentity();onReady(status==='review_required')}catch(reason){if(String(reason).includes('identity_request_not_found'))onReady(false);else onReady(true)}}
  if(step==='unavailable')return <PortalShell title="Estamos finalizando a segurança do seu acesso." subtitle="O segundo fator de autenticação ainda não está disponível para sua conta. Tente novamente em alguns instantes ou fale com a equipe RUAH." safeCopy="Seu espaço privado permanece bloqueado e seguro"><button className="portal-submit" onClick={bootstrap}>Tentar novamente</button><button className="portal-link" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/entrar'))}>Voltar para entrar</button></PortalShell>
  if(step==='rate_limit')return <PortalShell title="Vamos aguardar um instante." subtitle="Muitas tentativas foram feitas. Aguarde alguns minutos antes de tentar novamente." safeCopy="Seu espaço privado permanece bloqueado e seguro"><button className="portal-link" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/entrar'))}>Voltar para entrar</button></PortalShell>
  if(step==='unexpected')return <PortalShell title="Não conseguimos concluir a verificação agora." subtitle="Tente novamente em alguns instantes. Seus dados privados continuam protegidos." safeCopy="Seu espaço privado permanece bloqueado e seguro"><button className="portal-submit" onClick={bootstrap}>Tentar novamente</button><button className="portal-link" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/entrar'))}>Voltar para entrar</button></PortalShell>
  if(step==='phone')return <PortalShell title="Proteja seu espaço privado." subtitle="Para manter seus dados seguros, confirme seu celular." safeCopy="Configuração de acesso em duas etapas"><form className="portal-form" onSubmit={send}><label><span>Celular</span><div><Phone/><input inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={phone} onChange={event=>setPhone(brPhone(event.target.value))}/></div></label>{codeError&&<div className="portal-error">{codeError}</div>}<button className="portal-submit">Enviar código</button></form></PortalShell>
  if(step==='code')return <PortalShell title="Confirme que é você." subtitle={`Enviamos um código de segurança para ${maskedPhone(sentTo)}.`} safeCopy="Acesso protegido em duas etapas"><form className="portal-form" onSubmit={verify}><label><span>Código de segurança</span><input className="portal-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))}/></label>{codeError&&<div className="portal-error">{codeError}</div>}<button className="portal-submit">Confirmar acesso</button></form><button className="portal-link" disabled={seconds>0} onClick={resend}>{seconds>0?`Reenviar código em ${seconds}s`:'Reenviar código'}</button><button className="portal-link" onClick={()=>{setPhone('');setFactorId('');setChallengeId('');setStep('phone')}}>Alterar telefone</button></PortalShell>
  return <PortalShell title={step==='verifying'?'Confirmando seu acesso':'Preparando sua segurança'} subtitle="Aguarde um instante." safeCopy="Seus dados privados continuam protegidos"><div className="portal-mfa-loading"><LoaderCircle className="spin"/></div></PortalShell>
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
      <button className="portal-submit" disabled={loading || !isSupabaseConfigured}>{loading ? <LoaderCircle className="spin" /> : 'ENTRAR'}</button>
    </form>
    <button className="portal-link" onClick={()=>go('/minha-ruah/recuperar')}>Esqueci minha senha</button>
    <button className="portal-link" onClick={()=>go('/minha-ruah/cadastro')}>Ainda não tenho acesso</button>
  </PortalShell>
}

function IdentityLaunchGate({onReady,onReview}:{onReady:()=>void;onReview:()=>void}){
  const[failed,setFailed]=useState(false)
  const resolve=async()=>{setFailed(false);try{const status=await finalizeCustomerIdentity();if(status==='review_required')onReview();else onReady()}catch(reason){if(String(reason).includes('identity_request_not_found'))onReady();else setFailed(true)}}
  useEffect(()=>{const timer=window.setTimeout(()=>{void resolve()},0);return()=>window.clearTimeout(timer)},[]) // eslint-disable-line react-hooks/exhaustive-deps
  if(failed)return <PortalShell title="Não conseguimos concluir seu acesso agora." subtitle="Tente novamente em alguns instantes. Nenhum dado privado foi liberado."><button className="portal-submit" onClick={resolve}>Tentar novamente</button><button className="portal-link" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/entrar'))}>Voltar para entrar</button></PortalShell>
  return <div className="portal-loading"><LoaderCircle className="spin"/></div>
}

export function CustomerPortalRoot() {
  const [path, setPath] = useState(location.pathname)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const [aal,setAal]=useState<'aal1'|'aal2'|null>(null),[review,setReview]=useState(false)
  const [identityReady,setIdentityReady]=useState(false)
  useEffect(() => {
    const change = () => setPath(location.pathname)
    addEventListener('popstate', change)
    if (!supabase) return () => removeEventListener('popstate', change)
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {setSession(next);if(event==='SIGNED_IN'||event==='SIGNED_OUT'){setAal(null);setReview(false);setIdentityReady(false)}})
    return () => { removeEventListener('popstate', change); data.subscription.unsubscribe() }
  }, [])
  if (!ready) return <div className="portal-loading"><LoaderCircle className="spin" /></div>
  if(path==='/minha-ruah/cadastro')return <RegistrationPage/>
  if(path==='/minha-ruah/recuperar')return <RecoveryPage/>
  if(path==='/minha-ruah/confirmar-recuperacao')return <RecoveryConfirmationPage/>
  if(path==='/minha-ruah/privacidade')return <LegalPage/>
  if(path==='/minha-ruah/termos')return <LegalPage terms/>
  if (path === '/minha-ruah/ativar-conta') return <ActivateStartPage />
  if (path === '/minha-ruah/criar-senha'||path === '/minha-ruah/ativar') return <ActivateCompletePage />
  if (path === '/minha-ruah/redefinir-senha') return <ActivateCompletePage recovery />
  if (path === '/minha-ruah/login') { go('/minha-ruah/entrar'); return null }
  if (path === '/minha-ruah/entrar') { if (session) { go('/minha-ruah'); return null } return <PortalLoginPage /> }
  if (!session) { go('/minha-ruah/entrar'); return null }
  if(review)return <PortalShell title="Estamos finalizando seu acesso." subtitle="Para proteger seus dados, precisamos confirmar algumas informações antes de vincular seu histórico. A equipe RUAH foi avisada."><button className="portal-submit" onClick={()=>supabase!.auth.signOut().then(()=>go('/minha-ruah/entrar'))}>Voltar</button></PortalShell>
  if(aal===null){supabase!.auth.mfa.getAuthenticatorAssuranceLevel().then(({data})=>setAal(data?.currentLevel==='aal2'?'aal2':'aal1'));return <div className="portal-loading"><LoaderCircle className="spin"/></div>}
  if(path==='/minha-ruah/mfa'||(publicEnv.customerMfaRequired&&aal!=='aal2'))return <MfaPage onReady={(needsReview)=>{if(needsReview)setReview(true);else{setAal('aal2');setIdentityReady(true);go('/minha-ruah')}}}/>
  if(!identityReady)return <IdentityLaunchGate onReady={()=>setIdentityReady(true)} onReview={()=>setReview(true)}/>
  return <CustomerPortalApp path={path} navigate={go} onSignOut={() => supabase!.auth.signOut().then(() => go('/minha-ruah/entrar'))} />
}
