import { FormEvent, useEffect, useState } from 'react'
import { Check, Home, HelpCircle, KeyRound, LoaderCircle, Package, Truck, UserRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  AddressSnapshot, CustodyItem, PurchaseHistoryItem, DeliveryHistoryItem, ShipmentRequest, SupportTicket,
  cancelShipmentRequest, confirmShipmentRequest, createShipmentRequest, createSupportTicket, fetchCustody,
  customerPortalErrorMessage, fetchDeliveryHistory, fetchMyRequests, fetchMyTickets, fetchProfile, fetchPurchaseHistory, maskCpf, ticketCategoryLabel,
} from '../lib/customer-portal'
import { groupCustomerCustody, summarizeCustomerCustody } from './customer-custody-summary'

type Tab = 'inicio' | 'perfumes' | 'envios' | 'ajuda' | 'conta'
const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'inicio', label: 'Início', icon: Home }, { id: 'perfumes', label: 'Perfumes', icon: Package },
  { id: 'envios', label: 'Envios', icon: Truck }, { id: 'ajuda', label: 'Ajuda', icon: HelpCircle },
  { id: 'conta', label: 'Conta', icon: UserRound },
]
const brl = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
const shortDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value)) : '—'
const shipmentStatusLabel: Record<string, string> = {
  draft: 'Em preparação', requested: 'Em preparação', awaiting_customer_approval: 'Aguardando sua aprovação',
  customer_approved: 'Envio aprovado', label_pending: 'Emitindo etiqueta', label_released: 'Pronto para postar',
  posted: 'Postado — a caminho', delivered: 'Entregue', cancelled: 'Cancelado',
}

function RequestFlow({ perfumeName, allocations, onDone, onCancel }: { perfumeName: string; allocations: CustodyItem[]; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<'select' | 'address' | 'sending'>('select')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [address, setAddress] = useState<AddressSnapshot>({ name: '', postal_code: '', address_line: '', address_number: '', complement: '', district: '', city: '', state: '' })
  const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState('')
  useEffect(() => { fetchProfile().then((p) => setAddress({ name: p.name, postal_code: p.postal_code ?? '', address_line: p.address_line ?? '', address_number: p.address_number ?? '', complement: p.complement ?? '', district: p.district ?? '', city: p.city ?? '', state: p.state ?? '', phone: p.phone ?? undefined })).catch(() => {}) }, [])
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const totalMl = allocations.filter((a) => selected.has(a.allocation_id)).reduce((sum, a) => sum + a.quantity_ml, 0)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!confirmed || selected.size === 0) return
    setStep('sending'); setError('')
    try { await createShipmentRequest([...selected], address); onDone() }
    catch (reason) { setError(customerPortalErrorMessage(reason, 'Não foi possível enviar sua solicitação.')); setStep('address') }
  }
  return <div className="portal-sheet">
    <header><strong>Solicitar envio — {perfumeName}</strong><button onClick={onCancel}>Fechar</button></header>
    {step === 'select' && <div className="portal-sheet-body">
      {allocations.map((a) => <label key={a.allocation_id} className={`portal-check-card ${a.requested ? 'disabled' : ''}`}>
        <input type="checkbox" disabled={a.requested} checked={selected.has(a.allocation_id)} onChange={() => toggle(a.allocation_id)} />
        <div><strong>{a.quantity_ml} ml</strong><span>{a.requested ? 'Já solicitado' : `Comprado em ${shortDate(a.sale_date)}`}</span></div>
      </label>)}
      <button className="portal-submit" disabled={selected.size === 0} onClick={() => setStep('address')}>Continuar ({totalMl} ml selecionados)</button>
    </div>}
    {step === 'address' && <form className="portal-sheet-body portal-form" onSubmit={submit}>
      <label><span>Nome</span><input required value={address.name} onChange={(e) => setAddress({ ...address, name: e.target.value })} /></label>
      <label><span>CEP</span><input required value={address.postal_code} onChange={(e) => setAddress({ ...address, postal_code: e.target.value })} /></label>
      <label><span>Rua</span><input required value={address.address_line} onChange={(e) => setAddress({ ...address, address_line: e.target.value })} /></label>
      <div className="portal-form-row">
        <label><span>Número</span><input required value={address.address_number} onChange={(e) => setAddress({ ...address, address_number: e.target.value })} /></label>
        <label><span>Complemento</span><input value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} /></label>
      </div>
      <label><span>Bairro</span><input required value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} /></label>
      <div className="portal-form-row">
        <label><span>Cidade</span><input required value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} /></label>
        <label><span>UF</span><input required maxLength={2} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })} /></label>
      </div>
      <label className="portal-check-inline"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmo que este endereço está correto.</label>
      {error && <div className="portal-error">{error}</div>}
      <button className="portal-submit" disabled={!confirmed}>Solicitar envio</button>
    </form>}
    {step === 'sending' && <div className="portal-sheet-body portal-centered"><LoaderCircle className="spin" /></div>}
  </div>
}

function HomePage({ custody, requests, onRequest, greeting, onPerfumes, onShipments, onHelp }: { custody: CustodyItem[]; requests: ShipmentRequest[]; onRequest: (perfumeId: string) => void;greeting:string;onPerfumes:()=>void;onShipments:()=>void;onHelp:()=>void }) {
  const groups = groupCustomerCustody(custody,requests)
  const summary = summarizeCustomerCustody(custody,requests)
  return <div className="portal-page portal-home">
    <section className="portal-welcome"><span>BEM-VINDA À SUA ÁREA PRIVADA</span><h1>Olá{greeting?`, ${greeting}`:''}.</h1><p>Aqui está a sua história com a RUAH, com a clareza e o cuidado que ela merece.</p></section>
    <section className="portal-collection"><span>MEU ACERVO</span><strong>{groups.length} {groups.length===1?'perfume':'perfumes'} na RUAH</strong><p>{summary.physicalMl} ml sob os cuidados da RUAH</p><button onClick={onPerfumes}>Ver meus perfumes</button></section>
    <h2>Agora na RUAH</h2>
    <div className="portal-summary"><div><strong>{summary.availableMl} ml</strong><span>Disponível para envio</span></div><div><strong>{summary.awaitingApprovalMl} ml</strong><span>Aguardando sua aprovação</span></div><div><strong>{summary.preparingMl} ml</strong><span>Em preparação</span></div><div><strong>{summary.inTransitMl} ml</strong><span>Em transporte</span></div></div>
    <div className="portal-home-links"><button onClick={onShipments}><strong>Meus envios</strong><span>Acompanhe cada etapa</span></button><button onClick={onHelp}><strong>Preciso de ajuda</strong><span>Fale diretamente com a RUAH</span></button></div>
    <h2>Meus perfumes</h2>
    {groups.length === 0 && <p className="portal-empty">Você ainda não tem perfumes guardados na RUAH.</p>}
    {groups.map((g) => {const activeRequest=g.active_request?.shipment_status==='awaiting_customer_approval'?g.active_request:undefined;return <div className="portal-card" key={g.perfume_id}>
      <strong>{g.perfume_name}</strong><span>{g.total_ml} ml na RUAH · {g.available_ml} ml disponíveis</span>
      {g.open_requested_ml>0&&<span>{g.open_requested_ml} ml em solicitação</span>}
      {activeRequest&&<span>AGUARDANDO SUA APROVAÇÃO</span>}
      {g.available_ml > 0 && <button onClick={() => onRequest(g.perfume_id)}>{g.open_requested_ml>0?'SOLICITAR OUTRO ENVIO':'SOLICITAR ENVIO'}</button>}
      {activeRequest&&<button onClick={onShipments}>APROVAR ENVIO</button>}
    </div>})}
  </div>
}

function ShipmentsPage({ requests, reload, onOpenHistory }: { requests: ShipmentRequest[]; reload: () => void; onOpenHistory: () => void }) {
  const [busy, setBusy] = useState('')
  const [error,setError]=useState('')
  const act = async (fn: () => Promise<void>, id: string) => { setBusy(id);setError('');try { await fn() } catch(reason){setError(customerPortalErrorMessage(reason))} finally { setBusy(''); reload() } }
  return <div className="portal-page">
    <h2>Meus envios</h2>
    <button className="portal-link" onClick={onOpenHistory}>Ver histórico completo</button>
    {error&&<div className="portal-error">{error}</div>}
    {requests.length === 0 && <p className="portal-empty">Nenhuma solicitação ainda.</p>}
    {requests.map((r) => <div className="portal-card portal-request-card" key={r.request_id}>
      <strong>{r.items?.map((i) => `${i.perfume} (${i.quantity_ml}ml)`).join(', ') || 'Solicitação'}</strong>
      <div className="portal-progress">
        {[['Solicitação recebida', true], ['Frete cotado', Boolean(r.converted_shipment_id)], ['Envio confirmado', Boolean(r.shipment_status && r.shipment_status !== 'awaiting_customer_approval' && r.shipment_status !== 'draft' && r.shipment_status !== 'requested')], ['Postado', r.shipment_status === 'posted' || r.shipment_status === 'delivered']]
          .map(([label, done]) => <span key={label as string} className={done ? 'done' : ''}>{done ? <Check size={12} /> : '○'} {label as string}</span>)}
      </div>
      {(r.status === 'requested' || (r.status === 'converted' && ['draft','requested','awaiting_customer_approval','customer_approved'].includes(r.shipment_status??''))) && <button disabled={busy === r.request_id} onClick={() => act(() => cancelShipmentRequest(r.request_id), r.request_id)}>{r.awaiting_approval?'NÃO QUERO ENVIAR AGORA':'Cancelar solicitação'}</button>}
      {r.awaiting_approval && <div className="portal-quote"><div><strong>AGUARDANDO SUA APROVAÇÃO</strong><span>Frete<br/>{[r.carrier,r.service].filter(Boolean).join(' · ')} · {r.shipping_price != null ? brl(r.shipping_price) : '—'}</span></div><button disabled={busy === r.request_id} onClick={() => act(() => confirmShipmentRequest(r.request_id), r.request_id)}>APROVAR ENVIO</button></div>}
      {r.shipment_status === 'customer_approved' && <div className="portal-quote portal-quote-approved"><div><strong>✓ ENVIO APROVADO</strong><span>A equipe da RUAH seguirá com a preparação.</span></div></div>}
      {r.tracking_code && <div className="portal-tracking"><span>Rastreio</span><strong>{r.tracking_code}</strong></div>}
    </div>)}
  </div>
}

function HistoryPage() {
  const [purchases, setPurchases] = useState<PurchaseHistoryItem[]>([]); const [deliveries, setDeliveries] = useState<DeliveryHistoryItem[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { Promise.all([fetchPurchaseHistory(), fetchDeliveryHistory()]).then(([p, d]) => { setPurchases(p); setDeliveries(d) }).finally(() => setLoading(false)) }, [])
  if (loading) return <div className="portal-page portal-centered"><LoaderCircle className="spin" /></div>
  return <div className="portal-page">
    <h2>Histórico</h2>
    <h3>Compras</h3>
    {purchases.length === 0 && <p className="portal-empty">Nenhuma compra registrada.</p>}
    {purchases.map((p) => <div className="portal-card" key={p.sale_id}><strong>{p.perfume_name ?? 'Perfume'}</strong><span>{shortDate(p.sale_date)} · {p.quantity_ml ?? 0} ml · {brl(p.amount)}</span></div>)}
    <h3>Envios recebidos</h3>
    {deliveries.length === 0 && <p className="portal-empty">Nenhum envio recebido ainda.</p>}
    {deliveries.map((d) => <div className="portal-card" key={d.shipment_id}><strong>{d.items?.map((i) => i.perfume).join(', ') || 'Envio'}</strong><span>{shipmentStatusLabel[d.status] ?? d.status} · {shortDate(d.delivered_at ?? d.posted_at)}{d.tracking_code ? ` · ${d.tracking_code}` : ''}</span></div>)}
  </div>
}

function HelpPage({ tickets, reload }: { tickets: SupportTicket[]; reload: () => void }) {
  const [open, setOpen] = useState(false); const [category, setCategory] = useState('wrong_item'); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); setSaving(true); try { await createSupportTicket(category, description); setOpen(false); setDescription(''); reload() } finally { setSaving(false) } }
  return <div className="portal-page">
    <h2>Preciso de ajuda</h2>
    {!open && <button className="portal-submit" onClick={() => setOpen(true)}>Abrir novo chamado</button>}
    {open && <form className="portal-form portal-card" onSubmit={submit}>
      <label><span>O que aconteceu?</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(ticketCategoryLabel).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label><span>Conte o que aconteceu</span><textarea required rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button className="portal-submit" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : 'Enviar'}</button>
    </form>}
    {tickets.map((t) => <div className="portal-card" key={t.id}><strong>{ticketCategoryLabel[t.category] ?? t.category}</strong><span>{t.status === 'resolved' ? 'Resolvido' : t.status === 'in_progress' ? 'Em atendimento' : 'Aberto'} · {shortDate(t.created_at)}</span><p>{t.description}</p></div>)}
  </div>
}

function AccountPage({ onSignOut }: { onSignOut: () => void }) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof fetchProfile>> | null>(null)
  const [changing,setChanging]=useState(false),[password,setPassword]=useState(''),[message,setMessage]=useState('')
  useEffect(() => { fetchProfile().then(setProfile).catch(() => {}) }, [])
  return <div className="portal-page">
    <h2>Minha conta</h2>
    {profile && <div className="portal-card">
      <strong>{profile.name}</strong>
      <span>{profile.email ?? '—'}</span>
      <span>{profile.phone ?? '—'}</span>
      <span>CPF {profile.cpf_masked ?? maskCpf('')}</span>
      <span>{[profile.address_line, profile.address_number, profile.district, profile.city, profile.state].filter(Boolean).join(', ') || 'Endereço não cadastrado'}</span>
    </div>}
    {!changing?<button className="portal-account-action" onClick={()=>setChanging(true)}><KeyRound/>Alterar senha</button>:<form className="portal-form portal-card" onSubmit={async event=>{event.preventDefault();setMessage('');if(password.length<10||!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/\d/.test(password)||!/[^A-Za-z0-9]/.test(password))return setMessage('Use 10 caracteres com maiúscula, minúscula, número e símbolo.');const {error}=await supabase!.auth.updateUser({password});setMessage(error?'Não foi possível alterar a senha.':'Senha alterada com segurança.');if(!error)setPassword('')}}><label><span>Nova senha</span><input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>{message&&<div className={message.startsWith('Senha alterada')?'portal-success':'portal-error'}>{message}</div>}<button className="portal-submit">Salvar nova senha</button><button type="button" className="portal-link" onClick={()=>setChanging(false)}>Cancelar</button></form>}
    <button className="portal-submit portal-danger" onClick={onSignOut}>Sair</button>
  </div>
}

export function CustomerPortalApp({ path, navigate, onSignOut }: { path: string; navigate: (p: string) => void; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('inicio')
  const showHistory = path === '/minha-ruah/historico'
  const [custody, setCustody] = useState<CustodyItem[]>([]); const [requests, setRequests] = useState<ShipmentRequest[]>([]); const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [requesting, setRequesting] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [greeting, setGreeting] = useState('')
  const [onboarding,setOnboarding]=useState(()=>localStorage.getItem('minha_ruah_onboarding_done')!=='true')
  const reload = () => Promise.all([fetchCustody(), fetchMyRequests(), fetchMyTickets()]).then(([c, r, t]) => { setCustody(c); setRequests(r); setTickets(t) })
  useEffect(() => { reload().finally(() => setLoading(false)); supabase?.auth.getUser().then(({ data }) => setGreeting(String(data.user?.user_metadata?.full_name ?? '').split(' ')[0] ?? '')) }, [])
  const groups = groupCustomerCustody(custody,requests)
  const activeGroup = groups.find((g) => g.perfume_id === requesting)
  return <div className="portal-app">
    {onboarding&&<div className="portal-onboarding" role="dialog" aria-modal="true" aria-label="Conheça o Minha RUAH"><section><span>MINHA RUAH</span><h2>Bem-vinda ao seu espaço.</h2><div><article><b>01</b><strong>Seu acervo</strong><p>Veja os perfumes que estão sob sua custódia.</p></article><article><b>02</b><strong>Seus envios</strong><p>Solicite e acompanhe seus perfumes.</p></article><article><b>03</b><strong>Atendimento RUAH</strong><p>Fale diretamente com nossa equipe.</p></article></div><button className="portal-submit" onClick={()=>{localStorage.setItem('minha_ruah_onboarding_done','true');setOnboarding(false)}}>Conhecer meu espaço</button><button className="portal-link" onClick={()=>{localStorage.setItem('minha_ruah_onboarding_done','true');setOnboarding(false)}}>Pular apresentação</button></section></div>}
    <header className="portal-header"><div><span>RUAH</span><strong>Minha RUAH</strong></div>{greeting && <em>Olá, {greeting}</em>}</header>
    <main className="portal-main">
      {loading ? <div className="portal-centered"><LoaderCircle className="spin" /></div> : showHistory ? <>
        <button className="portal-link" onClick={() => navigate('/minha-ruah')}>← Voltar</button>
        <HistoryPage />
      </> : <>
        {tab === 'inicio' && <HomePage custody={custody} requests={requests} onRequest={setRequesting} greeting={greeting} onPerfumes={()=>setTab('perfumes')} onShipments={()=>setTab('envios')} onHelp={()=>setTab('ajuda')} />}
        {tab === 'perfumes' && <div className="portal-page">
          <h2>Meus perfumes</h2>
          {groups.length === 0 && <p className="portal-empty">Você ainda não tem perfumes guardados na RUAH.</p>}
          {groups.map((g) => {const activeRequest=g.active_request;return <div className="portal-card" key={g.perfume_id}><strong>{g.perfume_name}</strong><span>{g.total_ml} ml sob os cuidados da RUAH</span><span>Disponível para nova solicitação: {g.available_ml} ml</span>{g.open_requested_ml>0&&<span>Em solicitação: {g.open_requested_ml} ml</span>}{activeRequest?.shipment_status==='awaiting_customer_approval'&&<><span>AGUARDANDO SUA APROVAÇÃO</span><span>{[activeRequest.carrier,activeRequest.service].filter(Boolean).join(' · ')} · {activeRequest.shipping_price!=null?brl(activeRequest.shipping_price):'—'}</span><button onClick={()=>setTab('envios')}>APROVAR ENVIO</button></>}{activeRequest&&activeRequest.shipment_status!=='awaiting_customer_approval'&&<span>{shipmentStatusLabel[activeRequest.shipment_status??'']??'Em preparação'}</span>}{g.available_ml > 0 && <button onClick={() => setRequesting(g.perfume_id)}>{g.open_requested_ml>0?'SOLICITAR OUTRO ENVIO':'SOLICITAR ENVIO'}</button>}</div>})}
        </div>}
        {tab === 'envios' && <ShipmentsPage requests={requests} reload={reload} onOpenHistory={() => navigate('/minha-ruah/historico')} />}
        {tab === 'ajuda' && <HelpPage tickets={tickets} reload={reload} />}
        {tab === 'conta' && <AccountPage onSignOut={onSignOut} />}
      </>}
    </main>
    {activeGroup?.available_allocations.length ? <RequestFlow perfumeName={activeGroup.perfume_name} allocations={activeGroup.available_allocations} onDone={() => { setRequesting(null); reload(); setTab('envios') }} onCancel={() => setRequesting(null)} /> : null}
    <nav className="portal-bottom-nav" aria-label="Navegação Minha RUAH">{tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-current={tab===id?'page':undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={20} /><span>{label}</span></button>)}</nav>
  </div>
}
