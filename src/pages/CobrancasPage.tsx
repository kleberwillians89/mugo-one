import{useEffect,useMemo,useRef,useState}from'react'
import{Check,CircleDollarSign,Download,ExternalLink,Send}from'lucide-react'
import{brl,clientNumber,shortDate}from'../lib/format'
import{downloadNodeAsPng}from'../lib/download-image'
import{useHasPermission}from'../lib/PermissionsContext'
import{CollectionSaleRow,fetchCollectionsPending,fetchDaviExcelDistinct,logCollectionMessageCopied,registerCollectionPayment}from'../lib/records'
import{fetchSaleItemsSummaries,itemsSummaryLabel}from'../lib/sale-items'
import{
 CollectionMessageTemplate,CollectionTemplateSituation,RecentlyPaidCollection,defaultTemplateFor,ensureCollectionTemplatesSeeded,fetchCollectionsPaidThisMonth,
 fetchOrganizationCollectionSettings,fetchRecentlyPaidCollections,renderCollectionTemplate,sendCollectionMessage,
}from'../lib/collections'
import{useOrganizationBrand}from'../components/OrganizationBrandMark'
import{CollectionsSetupWizard}from'../components/CollectionsSetupWizard'
import{EmptyState,FormField,Modal,PageHeader,PrimaryButton,SecondaryButton,useToast}from'../components/ui'
import{COLLECTION_IMAGE_PIXEL_RATIO,CollectionSummaryImageCard,CollectionSummaryLine}from'../components/CollectionSummaryImageCard'
import'./CobrancasPage.css'

type SaleWithItem=CollectionSaleRow&{itemLabel:string}
type ClientGroup={
 client_id:string;client_number:number|null;client_name:string;sales:SaleWithItem[];total:number
 last_message_copied_at:string|null;message_copied_count:number;owner_name:string|null;due_date:string|null
 overdue:boolean;situation:CollectionTemplateSituation
 last_attempt_channel:string|null;last_attempt_status:string|null;last_attempt_at:string|null
}
type MainFilter='pending'|'overdue'|'paid'|'all'

const openClient=(clientId:string)=>{history.pushState({},'',`/clientes/${clientId}`);dispatchEvent(new PopStateEvent('popstate'))}
const goToCommunications=()=>{history.pushState({},'',`/configuracoes/comunicacoes`);dispatchEvent(new PopStateEvent('popstate'))}
const formatAt=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value))
const todayISO=()=>new Date().toISOString().slice(0,10)
const CHANNEL_LABEL:Record<string,string>={email:'E-mail',whatsapp:'WhatsApp',sms:'SMS',generic:'Canal'}

function groupByClient(rows:CollectionSaleRow[],itemLabels:Map<string,string>):ClientGroup[]{
 const map=new Map<string,ClientGroup>()
 const today=todayISO()
 for(const row of rows){
  const withItem:SaleWithItem={...row,itemLabel:itemLabels.get(row.id)??'Item não descrito'}
  const rowOverdue=Boolean(row.due_date&&row.due_date<today)
  const existing=map.get(row.client_id)
  if(existing){
   existing.sales.push(withItem);existing.total+=row.amount
   if(!existing.due_date||(row.due_date&&row.due_date<existing.due_date))existing.due_date=row.due_date
   if(rowOverdue)existing.overdue=true
   if(!existing.owner_name&&row.owner_name)existing.owner_name=row.owner_name
   if(row.last_attempt_at&&(!existing.last_attempt_at||row.last_attempt_at>existing.last_attempt_at)){existing.last_attempt_at=row.last_attempt_at;existing.last_attempt_channel=row.last_attempt_channel;existing.last_attempt_status=row.last_attempt_status}
  }
  else map.set(row.client_id,{
   client_id:row.client_id,client_number:row.client_number,client_name:row.client_name,sales:[withItem],total:row.amount,
   last_message_copied_at:row.last_message_copied_at,message_copied_count:row.message_copied_count,owner_name:row.owner_name,due_date:row.due_date,
   overdue:rowOverdue,situation:'initial',
   last_attempt_channel:row.last_attempt_channel,last_attempt_status:row.last_attempt_status,last_attempt_at:row.last_attempt_at,
  })
 }
 for(const group of map.values())group.situation=group.overdue?'overdue':group.due_date===today?'due_today':'initial'
 return[...map.values()].sort((a,b)=>a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'}))
}

function TemplatePicker({templates,value,onChange}:{templates:CollectionMessageTemplate[];value:string;onChange:(id:string)=>void}){
 const active=templates.filter(t=>t.active)
 if(active.length<=1)return<span className="collections-template-name">{active[0]?.name??'Nenhum template'}</span>
 return<label className="collections-template-picker">
  <select value={value} onChange={e=>onChange(e.target.value)} aria-label="Trocar modelo de mensagem">{active.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select>
 </label>
}

/**
 * Fluxo único "Cobrar" (briefing §15-17): abre direto na prévia — o
 * template já vem escolhido pelo padrão/situação da organização, o
 * usuário só decide se edita, copia ou envia. Editar aqui NUNCA altera
 * o template original — é sempre uma cópia local (briefing §17).
 */
function CobrarModal({group,templates,onClose,onSent}:{group:ClientGroup;templates:CollectionMessageTemplate[];onClose:()=>void;onSent:()=>void}){
 const toast=useToast()
 const canSend=useHasPermission('collections.send')
 const canConfigureComms=useHasPermission('communications.manage')
 const initialTemplate=useMemo(()=>defaultTemplateFor(templates,group.situation),[templates,group.situation])
 const[templateId,setTemplateId]=useState(()=>initialTemplate?.id??'')
 const[text,setText]=useState('')
 const[subject,setSubject]=useState('')
 const[editing,setEditing]=useState(false)
 const[copying,setCopying]=useState(false)
 const[sending,setSending]=useState(false)
 const[sendOutcome,setSendOutcome]=useState<{status:'sent'|'failed';errorCode:string|null;errorMessage:string|null}|null>(null)
 const saleIds=useMemo(()=>group.sales.map(s=>s.id),[group])
 const loading=text===''
 useEffect(()=>{
  if(!templateId)return
  let cancelled=false
  renderCollectionTemplate(group.client_id,saleIds,templateId)
   .then(r=>{if(!cancelled){setText(r.body);setSubject(r.subject)}})
   .catch(reason=>{if(!cancelled)toast.push(reason instanceof Error?reason.message:'Não foi possível montar a mensagem.',{tone:'error'})})
  return()=>{cancelled=true}
 },[templateId,group.client_id,saleIds,toast])

 const copy=async()=>{
  setCopying(true)
  try{
   await navigator.clipboard.writeText(text)
   await logCollectionMessageCopied(group.client_id,{sale_ids:saleIds,template_id:templateId})
   toast.push('Mensagem copiada.',{tone:'success'})
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível copiar a mensagem.',{tone:'error'})}
  finally{setCopying(false)}
 }
 const send=async()=>{
  if(!templateId)return
  setSending(true);setSendOutcome(null)
  try{
   const result=await sendCollectionMessage(group.client_id,saleIds,templateId,'email')
   setSendOutcome({status:result.status,errorCode:result.errorCode,errorMessage:result.errorMessage})
   if(result.status==='sent'){toast.push('Cobrança enviada.',{tone:'success'});onSent();onClose()}
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível enviar a cobrança.',{tone:'error'})}
  finally{setSending(false)}
 }

 return<Modal open onClose={onClose} eyebrow="COBRANÇA" title={`Enviar cobrança para ${group.client_name}`} footer={<>
  <SecondaryButton loading={copying} onClick={()=>void copy()}>Copiar mensagem</SecondaryButton>
  {canSend&&<PrimaryButton loading={sending} disabled={loading||!templateId} onClick={()=>void send()} icon={<Send size={15}/>}>Enviar cobrança</PrimaryButton>}
 </>}>
  <div className="collections-cobrar-meta">
   <div><span>Modelo</span><TemplatePicker templates={templates} value={templateId} onChange={id=>{setText('');setSendOutcome(null);setTemplateId(id)}}/></div>
   <div><span>Canal</span><strong>E-mail</strong></div>
  </div>
  {sendOutcome?.status==='failed'&&<div className="collections-provider-hint">
   <p>{sendOutcome.errorCode==='provider_not_configured'?'E-mail ainda não está conectado.':(sendOutcome.errorMessage??'Não foi possível enviar agora.')}</p>
   <div>
    {sendOutcome.errorCode==='provider_not_configured'&&canConfigureComms&&<SecondaryButton onClick={goToCommunications}>Configurar e-mail</SecondaryButton>}
    <SecondaryButton onClick={()=>void copy()}>Copiar mensagem</SecondaryButton>
   </div>
  </div>}
  <div className="collections-preview">
   <div className="collections-preview-head">
    <span>Prévia</span>
    {!editing&&<button type="button" className="collections-edit-link" onClick={()=>setEditing(true)}>Editar mensagem</button>}
   </div>
   {subject&&<p className="collections-preview-subject">{subject}</p>}
   {editing
    ?<textarea className="collections-copy-text" value={text} onChange={e=>setText(e.target.value)} rows={11} aria-label="Mensagem de cobrança"/>
    :<div className="collections-preview-body" aria-label="Prévia da mensagem de cobrança">{loading?'Montando mensagem…':text}</div>}
   {editing&&<p className="collections-edit-hint">Esta alteração vale só para este envio — o modelo original não muda.</p>}
  </div>
 </Modal>
}

/**
 * Baixa a imagem em UM clique — sem preview, sem modal. Monta o card fora
 * da tela (mesmo layout, mesmos dados já em memória — nenhuma nova
 * consulta), captura com html-to-image assim que ele existe no DOM, baixa
 * o PNG e se desmonta.
 */
function CollectionImageDownload({group,onDone}:{group:ClientGroup;onDone:()=>void}){
 const toast=useToast()
 const brand=useOrganizationBrand()
 const nodeRef=useRef<HTMLDivElement>(null)
 const lines:CollectionSummaryLine[]=useMemo(()=>group.sales.map(s=>({id:s.id,itemLabel:s.itemLabel,amount:s.amount})),[group])
 useEffect(()=>{
  let cancelled=false
  const run=async()=>{
   if(!nodeRef.current)return
   try{
    const name=`cobranca-${group.client_id}-${new Date().toISOString().slice(0,10)}.png`
    await downloadNodeAsPng(nodeRef.current,name,COLLECTION_IMAGE_PIXEL_RATIO)
    if(!cancelled)toast.push('Imagem baixada.',{tone:'success'})
   }catch(reason){
    if(!cancelled)toast.push(reason instanceof Error?reason.message:'Não foi possível gerar a imagem.',{tone:'error'})
   }finally{
    if(!cancelled)onDone()
   }
  }
  void run()
  return()=>{cancelled=true}
 },[group,onDone,toast])
 return<div className="collections-image-offscreen" aria-hidden="true"><CollectionSummaryImageCard ref={nodeRef} group={{client_name:group.client_name,sales:lines,total:group.total}} brand={brand}/></div>
}

function RegisterPaymentModal({group,onClose,onPaid}:{group:ClientGroup;onClose:()=>void;onPaid:()=>void}){
 const toast=useToast()
 const[selected,setSelected]=useState<Set<string>>(()=>new Set(group.sales.map(s=>s.id)))
 const[paidAt,setPaidAt]=useState(()=>new Date().toISOString().slice(0,10))
 const[method,setMethod]=useState('')
 const[notes,setNotes]=useState('')
 const[methodSuggestions,setMethodSuggestions]=useState<string[]>([])
 const[saving,setSaving]=useState(false)
 const[error,setError]=useState('')
 useEffect(()=>{fetchDaviExcelDistinct('method',{},'').then(result=>setMethodSuggestions(result.values.map(v=>v.value).filter(v=>v!=='__BLANK__'))).catch(()=>{})},[])
 const toggle=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})
 const total=group.sales.filter(s=>selected.has(s.id)).reduce((sum,s)=>sum+s.amount,0)
 const confirm=async()=>{
  if(!selected.size){setError('Selecione ao menos uma venda.');return}
  if(!method.trim()){setError('Informe a forma de pagamento.');return}
  setSaving(true);setError('')
  try{
   await registerCollectionPayment([...selected],paidAt,method.trim(),notes.trim()||undefined)
   toast.push('Pagamento registrado.',{tone:'success'})
   onPaid();onClose()
  }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível registrar o pagamento.')}
  finally{setSaving(false)}
 }
 return<Modal open onClose={onClose} eyebrow="COBRANÇA" title="Registrar pagamento" footer={<><SecondaryButton onClick={onClose}>CANCELAR</SecondaryButton><PrimaryButton loading={saving} onClick={()=>void confirm()}>CONFIRMAR PAGAMENTO</PrimaryButton></>}>
  <p className="collections-payment-client"><strong>{group.client_name}</strong> · Nº {clientNumber(group.client_number)}</p>
  <ul className="collections-payment-sales">
   {group.sales.map(s=><li key={s.id}><label><input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggle(s.id)}/><span>{shortDate(s.sale_date)} · {s.itemLabel}</span><strong>{brl(s.amount)}</strong></label></li>)}
  </ul>
  <p className="collections-payment-total">VALOR TOTAL SELECIONADO <strong>{brl(total)}</strong></p>
  <div className="collections-payment-fields">
   <FormField label="Data do pagamento" htmlFor="collections-paid-at" required><input id="collections-paid-at" type="date" value={paidAt} onChange={e=>setPaidAt(e.target.value)}/></FormField>
   <FormField label="Forma de pagamento" htmlFor="collections-method" required hint="Pix, cartão, dinheiro…">
    <input id="collections-method" list="collections-method-options" value={method} onChange={e=>setMethod(e.target.value)}/>
    <datalist id="collections-method-options">{methodSuggestions.map(value=><option value={value} key={value}/>)}</datalist>
   </FormField>
   <FormField label="Observação" htmlFor="collections-notes" hint="Opcional"><textarea id="collections-notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={2}/></FormField>
  </div>
  {error&&<p className="collections-payment-error" role="alert">{error}</p>}
 </Modal>
}

export function CobrancasPage(){
 const canRegisterPayment=useHasPermission('sales.edit')
 const canConfigure=useHasPermission('collections.configure')
 const[rows,setRows]=useState<CollectionSaleRow[]>([])
 const[itemLabels,setItemLabels]=useState<Map<string,string>>(new Map())
 const[templates,setTemplates]=useState<CollectionMessageTemplate[]>([])
 const[settingsConfigured,setSettingsConfigured]=useState(true)
 const[paidThisMonth,setPaidThisMonth]=useState(0)
 const[recentlyPaid,setRecentlyPaid]=useState<RecentlyPaidCollection[]>([])
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState('')
 const[search,setSearch]=useState('')
 const[filter,setFilter]=useState<MainFilter>('pending')
 const[cobrarGroup,setCobrarGroup]=useState<ClientGroup|null>(null)
 const[downloadGroup,setDownloadGroup]=useState<ClientGroup|null>(null)
 const[paymentGroup,setPaymentGroup]=useState<ClientGroup|null>(null)
 const[wizardOpen,setWizardOpen]=useState(false)

 const load=(term:string)=>fetchCollectionsPending(term)
  .then(async data=>{
   setRows(data)
   const summaries=await fetchSaleItemsSummaries(data.map(row=>row.id)).catch(()=>new Map())
   setItemLabels(new Map(data.map(row=>[row.id,itemsSummaryLabel(summaries.get(row.id),'Item não descrito')])))
  })
  .catch(reason=>setError(reason instanceof Error?reason.message:'Não foi possível carregar as cobranças.'))
  .finally(()=>setLoading(false))
 useEffect(()=>{const timer=setTimeout(()=>{setLoading(true);void load(search)},250);return()=>clearTimeout(timer)},[search])
 useEffect(()=>{
  fetchOrganizationCollectionSettings().then(settings=>setSettingsConfigured(Boolean(settings))).catch(()=>{})
  ensureCollectionTemplatesSeeded(canConfigure).then(setTemplates).catch(()=>{})
  fetchCollectionsPaidThisMonth().then(setPaidThisMonth).catch(()=>{})
  fetchRecentlyPaidCollections().then(setRecentlyPaid).catch(()=>{})
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])

 const allGroups=useMemo(()=>groupByClient(rows,itemLabels),[rows,itemLabels])
 const overdueGroups=useMemo(()=>allGroups.filter(g=>g.overdue),[allGroups])
 const visibleGroups=useMemo(()=>filter==='overdue'?overdueGroups:filter==='pending'||filter==='all'?allGroups:[],[allGroups,overdueGroups,filter])
 const totals={
  open:rows.reduce((sum,row)=>sum+row.amount,0),
  overdue:overdueGroups.reduce((sum,g)=>sum+g.total,0),
  paidThisMonth,
 }

 const reload=()=>{void load(search);fetchRecentlyPaidCollections().then(setRecentlyPaid).catch(()=>{});fetchCollectionsPaidThisMonth().then(setPaidThisMonth).catch(()=>{})}
 const noTemplates=templates.length===0

 return<div className="page collections-page">
  {cobrarGroup&&<CobrarModal group={cobrarGroup} templates={templates} onClose={()=>setCobrarGroup(null)} onSent={reload}/>}
  {downloadGroup&&<CollectionImageDownload group={downloadGroup} onDone={()=>setDownloadGroup(null)}/>}
  {paymentGroup&&<RegisterPaymentModal group={paymentGroup} onClose={()=>setPaymentGroup(null)} onPaid={reload}/>}
  {wizardOpen&&<CollectionsSetupWizard onClose={()=>setWizardOpen(false)} onDone={tpls=>{setTemplates(tpls);setSettingsConfigured(true);setWizardOpen(false)}}/>}
  <PageHeader eyebrow="MUGÔ ONE" title="Cobranças" description="Escolha um modelo, confira os dados e envie."/>
  {!settingsConfigured&&canConfigure&&
   <div className="collections-setup-banner">
    <div><strong>Configure como você recebe pagamentos.</strong><span>Leva menos de um minuto — PIX, transferência ou link, o que fizer sentido para você.</span></div>
    <PrimaryButton onClick={()=>setWizardOpen(true)}>Configurar agora</PrimaryButton>
   </div>}
  <div className="collections-summary">
   <div className="collections-stat collections-stat--primary"><span>A RECEBER</span><strong>{brl(totals.open)}</strong></div>
   <div className="collections-stat collections-stat--overdue"><span>VENCIDAS</span><strong>{brl(totals.overdue)}</strong></div>
   <div className="collections-stat"><span>RECEBIDAS NO MÊS</span><strong>{brl(totals.paidThisMonth)}</strong></div>
  </div>
  <div className="collections-toolbar">
   <label className="collections-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente ou número do cliente"/></label>
   <div className="collections-filter" role="group" aria-label="Filtrar cobranças">
    <button className={filter==='pending'?'selected':''} onClick={()=>setFilter('pending')}>PENDENTES</button>
    <button className={filter==='overdue'?'selected':''} onClick={()=>setFilter('overdue')}>VENCIDAS</button>
    <button className={filter==='paid'?'selected':''} onClick={()=>setFilter('paid')}>PAGAS</button>
    <button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>TODAS</button>
   </div>
  </div>
  {error&&<div className="notice"><span>{error}</span></div>}
  {filter==='paid'?
   (recentlyPaid.length===0?<EmptyState icon={Check} title="Nenhum pagamento recente" description="Pagamentos confirmados nos últimos 30 dias aparecem aqui."/>:
    <div className="collections-grid">
     {recentlyPaid.map(p=><article className="collections-card collections-card--paid" key={p.id}>
      <header>
       <div><span className="collections-card-number">Nº {clientNumber(p.clientNumber)}</span><h3>{p.clientName}</h3></div>
       <div className="collections-card-total"><span>PAGO</span><strong>{brl(p.amount)}</strong></div>
      </header>
      <p className="collections-card-meta">Pago em {shortDate(p.paidAt)}{p.paymentMethod&&<> · {p.paymentMethod}</>}</p>
      <footer><button className="collections-open-client" onClick={()=>openClient(p.clientId)}><ExternalLink size={14}/>ABRIR CLIENTE</button></footer>
     </article>)}
    </div>)
  :loading?<div className="empty card"><h3>Carregando cobranças…</h3></div>:
   visibleGroups.length===0?<EmptyState icon={CircleDollarSign} title={filter==='overdue'?'Nenhuma cobrança vencida':'Nenhuma cobrança pendente'} description="Nenhum cliente tem vendas comercialmente pendentes de pagamento no momento."/>:
   <div className="collections-grid">
    {visibleGroups.map(group=><article className={`collections-card${group.overdue?' collections-card--overdue':''}`} key={group.client_id}>
     <header>
      <div><span className="collections-card-number">Nº {clientNumber(group.client_number)}</span><h3>{group.client_name}</h3></div>
      <div className="collections-card-total"><span>{group.overdue?'VENCIDO':'EM ABERTO'}</span><strong>{brl(group.total)}</strong></div>
     </header>
     <p className="collections-card-meta">
      {group.sales.length} venda{group.sales.length===1?'':'s'} pendente{group.sales.length===1?'':'s'}
      {group.due_date&&<> · Vencimento: {shortDate(group.due_date)}</>}
      {group.owner_name&&<> · Responsável: {group.owner_name}</>}
      {group.last_attempt_at
       ?<> · Último contato: {CHANNEL_LABEL[group.last_attempt_channel??'']??group.last_attempt_channel} em {formatAt(group.last_attempt_at)}</>
       :group.message_copied_count?<> · Última mensagem copiada: {formatAt(group.last_message_copied_at!)}</>
       :<> · Nenhum contato ainda</>}
     </p>
     <footer>
      {noTemplates&&canConfigure
       ?<PrimaryButton onClick={()=>setWizardOpen(true)}>Configurar cobranças</PrimaryButton>
       :<PrimaryButton icon={<Send size={14}/>} onClick={()=>setCobrarGroup(group)}>COBRAR</PrimaryButton>}
      {group.sales.length>0&&<SecondaryButton icon={<Download size={14}/>} loading={downloadGroup?.client_id===group.client_id} disabled={!!downloadGroup&&downloadGroup.client_id!==group.client_id} onClick={()=>setDownloadGroup(group)}>BAIXAR IMAGEM</SecondaryButton>}
      <button className="collections-open-client" onClick={()=>openClient(group.client_id)}><ExternalLink size={14}/>ABRIR CLIENTE</button>
      {canRegisterPayment&&<SecondaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</SecondaryButton>}
     </footer>
    </article>)}
   </div>}
 </div>
}
