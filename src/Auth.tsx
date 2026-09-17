import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { App } from './App'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { PermissionsProvider } from './lib/PermissionsContext'
import { normalizeLoginIdentifier } from './lib/permissions'
import { QrBottlePage } from './pages/QrBottlePage'
import { InventoryStationPage } from './pages/InventoryStationPage'
import { InventoryCountPage } from './pages/InventoryCountPage'
import { PrintLabelPage } from './pages/PrintLabelPage'
import {PerfumePrintLabelPage} from './pages/PerfumePrintLabelPage'
import { ShipmentPrintPage } from './pages/ShipmentPrintPage'
import { SplitsDoDiaPrintPage } from './pages/SplitsDoDiaPrintPage'
import { CustomerPortalRoot } from './portal/CustomerPortalRoot'
import { ToastProvider } from './components/ui'
import { OrganizationProvider } from './core/organizations/OrganizationProvider'

const go = (path:string) => { window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) }
// Migração de nome de chave de storage (ruah_* -> mugo_one_*): nunca mais
// escrevemos a chave antiga, mas sessões abertas antes deste deploy ainda
// têm ela gravada no navegador — ler a nova primeiro, cair para a antiga
// só como compatibilidade temporária de leitura. Remover o fallback
// quando não houver mais sessão antiga plausível em uso.
const REMEMBER_KEY = 'mugo_one_remember'
const SESSION_KEY = 'mugo_one_session'
const readRemember = () => localStorage.getItem(REMEMBER_KEY) ?? localStorage.getItem('ruah_remember')
const readSessionActive = () => sessionStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem('ruah_session')
// Só aceita um "next" relativo à própria origem (nunca "//host" nem uma URL
// absoluta) — evita que um link de login vire redirecionamento aberto.
const safeNext = (raw:string|null) => raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
const message = (error:unknown) => {
  const text=error instanceof Error?error.message:'Não foi possível concluir a operação.'
  if(/invalid login/i.test(text))return 'E-mail ou senha incorretos.'
  if(/email not confirmed/i.test(text))return 'Confirme seu e-mail antes de entrar.'
  if(/rate limit/i.test(text))return 'Muitas tentativas. Aguarde alguns minutos.'
  return 'Não foi possível concluir. Verifique os dados e tente novamente.'
}

function AuthLayout({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}) {
  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><img src="/mugo-logo.png" alt="Mugô One"/><span>MUGÔ ONE</span></div><div><span>CRM E INTELIGÊNCIA COMERCIAL</span><h1>Inteligência que<br/>transforma relações.</h1><p>Dados comerciais protegidos para decisões mais precisas.</p></div><small><ShieldCheck/> Ambiente seguro Mugô One</small></section>
    <section className="auth-form-panel"><div className="auth-mobile-brand"><img src="/mugo-logo.png" alt="Mugô One"/></div><div className="auth-box"><span>MUGÔ ONE</span><h2>{title}</h2><p>{subtitle}</p>{!isSupabaseConfigured&&<div className="auth-error">Configure as variáveis públicas do Supabase para autenticar.</div>}{children}</div>
      <div className="mugo-signature" aria-label="Sistema desenvolvido pela Mugô">
        <video className="mugo-3d" autoPlay muted loop playsInline preload="metadata" aria-label="Símbolo tridimensional oficial da Mugô"><source src="/mugo-3d.mp4" type="video/mp4"/></video>
        <div><img src="/mugo-logo.png" alt="Logo oficial da Mugô"/><p>Sistema desenvolvido pela <strong>Mugô</strong></p><span>Tecnologia e inteligência</span></div>
      </div>
    </section></main>
}

export function LoginPage() {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false),[remember,setRemember]=useState(true)
  const [loading,setLoading]=useState(false),[error,setError]=useState('')
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setLoading(true);setError('')
    // "davi.vendas" vira e-mail interno só aqui, na hora de autenticar — a
    // pessoa nunca vê nem digita esse e-mail (briefing "LOGIN POR
    // USUÁRIO"). E-mail de verdade (contém "@") passa direto, preservando
    // o login de contas antigas sem qualquer mudança de comportamento.
    const {error}=await supabase.auth.signInWithPassword({email:normalizeLoginIdentifier(email),password})
    if(error)setError(message(error));else{localStorage.setItem(REMEMBER_KEY,String(remember));sessionStorage.setItem(SESSION_KEY,'active');go(safeNext(new URLSearchParams(location.search).get('next')))}setLoading(false)}
  return <AuthLayout title="Bem-vinda de volta" subtitle="Entre para acessar o CRM e a inteligência comercial."><form className="auth-form" onSubmit={submit}>
    <label><span>Usuário ou e-mail</span><div><Mail/><input type="text" autoComplete="username" required value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="usuario ou seu@email.com"/></div></label>
    <label><span>Senha</span><div><LockKeyhole/><input type={show?'text':'password'} autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Sua senha"/><button type="button" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
    <div className="auth-options"><label><input type="checkbox" checked={remember} onChange={(e)=>setRemember(e.target.checked)}/> Manter conectado</label><button type="button" onClick={()=>go('/recuperar-senha')}>Esqueci minha senha</button></div>
    {error&&<div className="auth-error">{error}</div>}<button className="auth-submit" disabled={loading||!isSupabaseConfigured}>{loading?<LoaderCircle className="spin"/>:'Entrar'}</button>
  </form></AuthLayout>
}

function EmailRecovery() {
  const [email,setEmail]=useState(''),[loading,setLoading]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState('')
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setLoading(true);setError('')
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${window.location.origin}/auth/callback?next=atualizar-senha`})
    if(error)setError(message(error));else setSent(true);setLoading(false)}
  return <AuthLayout title="Recuperar acesso" subtitle="Enviaremos um link seguro para o e-mail cadastrado.">{sent?<div className="auth-success">Confira sua caixa de entrada e também a pasta de spam.</div>:<form className="auth-form" onSubmit={submit}><label><span>E-mail</span><div><Mail/><input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)}/></div></label>{error&&<div className="auth-error">{error}</div>}<button className="auth-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Enviar link seguro'}</button></form>}<button className="auth-back" onClick={()=>go('/login')}>Voltar para o login</button></AuthLayout>
}

function PasswordPage({first=false}:{first?:boolean}) {
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[show,setShow]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;if(password.length<10)return setError('Use pelo menos 10 caracteres.');if(password!==confirm)return setError('As senhas não coincidem.')
    setLoading(true);const {error}=await supabase.auth.updateUser({password});if(error)setError(message(error));else go('/');setLoading(false)}
  return <AuthLayout title={first?'Defina sua senha':'Atualize sua senha'} subtitle="Crie uma senha forte e exclusiva para o Mugô One."><form className="auth-form" onSubmit={submit}>
    {[['Nova senha',password,setPassword],['Confirmar senha',confirm,setConfirm]].map(([label,value,setter])=><label key={label as string}><span>{label as string}</span><div><LockKeyhole/><input type={show?'text':'password'} autoComplete="new-password" required value={value as string} onChange={(e)=>(setter as (x:string)=>void)(e.target.value)}/><button type="button" onClick={()=>setShow(!show)}>{show?<EyeOff/>:<Eye/>}</button></div></label>)}
    {error&&<div className="auth-error">{error}</div>}<button className="auth-submit" disabled={loading}>{loading?<LoaderCircle className="spin"/>:'Salvar nova senha'}</button></form></AuthLayout>
}

function CallbackPage() {
  const [error,setError]=useState('')
  useEffect(()=>{const run=async()=>{if(!supabase)return setError('Supabase não configurado.')
    const code=new URLSearchParams(location.search).get('code');if(code){const result=await supabase.auth.exchangeCodeForSession(code);if(result.error)return setError(message(result.error))}
    const {data}=await supabase.auth.getSession();if(!data.session)return setError('O link expirou ou já foi utilizado.')
    const next=new URLSearchParams(location.search).get('next');const type=new URLSearchParams(location.hash.slice(1)).get('type')
    go(next==='atualizar-senha'||type==='recovery'?'/atualizar-senha':'/definir-senha')};run()},[])
  return <AuthLayout title="Validando acesso" subtitle="Aguarde enquanto confirmamos seu link seguro.">{error?<div className="auth-error">{error}</div>:<LoaderCircle className="auth-loader spin"/>}</AuthLayout>
}

export function AuthRoot() {
  const [path,setPath]=useState(location.pathname),[session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(!supabase)
  useEffect(()=>{const change=()=>setPath(location.pathname);addEventListener('popstate',change)
    if(!supabase)return()=>removeEventListener('popstate',change)
    const initialPath=location.pathname
    supabase.auth.getSession().then(async({data})=>{const trustedPrintPopup=(()=>{try{return initialPath.startsWith('/print/')&&window.opener?.location.origin===location.origin}catch{return false}})()
      if(data.session&&readRemember()==='false'&&!readSessionActive()&&!trustedPrintPopup)await supabase!.auth.signOut();else{if(data.session&&trustedPrintPopup)sessionStorage.setItem(SESSION_KEY,'active');setSession(data.session)}setReady(true)})
    const {data}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>{removeEventListener('popstate',change);data.subscription.unsubscribe()}},[])
  if(!ready)return <div className="app-loading"><LoaderCircle className="spin"/></div>
  // Customer Portal do Mugô One: gerencia a própria sessão do zero, nunca
  // passa pelo gate de sessão STAFF abaixo (cliente final não é
  // organization_member — nunca teria uma "sessão válida" nesse sentido —
  // e não deve, de jeito nenhum, cair no shell administrativo <App/>).
  // /portal é a rota canônica do produto; /minha-ruah continua funcionando
  // como alias de compatibilidade (a navegação interna do portal ainda usa
  // /minha-ruah/* nesta sprint — generalizar essas sub-rotas é trabalho de
  // uma sprint dedicada ao Customer Portal, não deste hotfix de branding).
  if(path.startsWith('/minha-ruah')||path.startsWith('/portal'))return <CustomerPortalRoot/>
  const publicRoute=['/login','/recuperar-senha','/auth/callback','/definir-senha','/atualizar-senha'].includes(path)
  // Ler um QR sem sessão ativa deve voltar para o MESMO frasco depois do
  // login (briefing "Modo Ilde", seção 3) — nunca perder o destino original.
  if(!session&&!publicRoute){go(`/login?next=${encodeURIComponent(path+location.search)}`);return null}
  if(session&&path==='/login'){go(safeNext(new URLSearchParams(location.search).get('next')));return null}
  if(path==='/login')return <LoginPage/>
  if(path==='/recuperar-senha')return <EmailRecovery/>
  if(path==='/auth/callback')return <CallbackPage/>
  if(path==='/definir-senha')return <PasswordPage first/>
  if(path==='/atualizar-senha')return <PasswordPage/>
  // Telas de operação física ("Modo Ilde"): renderizadas fora do shell
  // (sem sidebar/header do CRM) — "deve parecer aplicativo".
  const qrMatch=path.match(/^\/q\/([^/]+)$/)
  if(qrMatch)return <QrBottlePage token={decodeURIComponent(qrMatch[1])}/>
  // Documento de impressão isolado (seção 4 do briefing "finalizar fluxo
  // físico"): rota própria, sem AppShell — ver PrintLabelPage.tsx.
  if(path==='/print/perfume')return <PerfumePrintLabelPage/>
  if(path==='/print/shipment')return <ShipmentPrintPage/>
  if(path==='/print/splits-do-dia')return <SplitsDoDiaPrintPage/>
  const printMatch=path.match(/^\/print\/(bottle|split)$/)
  if(printMatch)return <PrintLabelPage kind={printMatch[1] as 'bottle'|'split'}/>
  if(path==='/estoque/leitor')return <InventoryStationPage/>
  const countMatch=path.match(/^\/estoque\/([0-9a-f-]{36})\/contagem$/i)
  if(countMatch)return <InventoryCountPage itemId={countMatch[1]}/>
  return <OrganizationProvider><PermissionsProvider><ToastProvider><App/></ToastProvider></PermissionsProvider></OrganizationProvider>
}
