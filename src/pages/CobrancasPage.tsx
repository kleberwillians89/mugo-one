import{useEffect,useMemo,useRef,useState}from'react'
import{ClipboardCopy,CircleDollarSign,Download,ExternalLink,Send}from'lucide-react'
import{brl,clientNumber,shortDate}from'../lib/format'
import{downloadNodeAsPng}from'../lib/download-image'
import{useHasPermission}from'../lib/PermissionsContext'
import{CollectionSaleRow,fetchCollectionsPending,fetchDaviExcelDistinct,logCollectionMessageCopied,registerCollectionPayment}from'../lib/records'
import{fetchSaleItemsSummaries,itemsSummaryLabel}from'../lib/sale-items'
import{CollectionMessageTemplate,fetchCollectionMessageTemplates,fetchOrganizationCollectionSettings,renderCollectionTemplate,sendCollectionMessage}from'../lib/collections'
import{useOrganizationBrand}from'../components/OrganizationBrandMark'
import{EmptyState,FormField,Modal,PageHeader,PrimaryButton,SecondaryButton,useToast}from'../components/ui'
import{COLLECTION_IMAGE_PIXEL_RATIO,CollectionSummaryImageCard,CollectionSummaryLine}from'../components/CollectionSummaryImageCard'
import'./CobrancasPage.css'

type SaleWithItem=CollectionSaleRow&{itemLabel:string}
type ClientGroup={client_id:string;client_number:number|null;client_name:string;sales:SaleWithItem[];total:number;last_message_copied_at:string|null;message_copied_count:number;owner_name:string|null;due_date:string|null;last_attempt_channel:string|null;last_attempt_status:string|null;last_attempt_at:string|null}
type CollectionFilter='all'|'never_copied'|'copied'

const openClient=(clientId:string)=>{history.pushState({},'',`/clientes/${clientId}`);dispatchEvent(new PopStateEvent('popstate'))}
const goToSettings=()=>{history.pushState({},'',`/configuracoes/cobrancas`);dispatchEvent(new PopStateEvent('popstate'))}
const formatAt=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value))
const CHANNEL_LABEL:Record<string,string>={email:'E-mail',whatsapp:'WhatsApp',sms:'SMS',generic:'Genérico'}

function groupByClient(rows:CollectionSaleRow[],itemLabels:Map<string,string>):ClientGroup[]{
 const map=new Map<string,ClientGroup>()
 for(const row of rows){
  const withItem:SaleWithItem={...row,itemLabel:itemLabels.get(row.id)??'Item não descrito'}
  const existing=map.get(row.client_id)
  if(existing){
   existing.sales.push(withItem);existing.total+=row.amount
   if(!existing.due_date||(row.due_date&&row.due_date<existing.due_date))existing.due_date=row.due_date
   if(!existing.owner_name&&row.owner_name)existing.owner_name=row.owner_name
   if(row.last_attempt_at&&(!existing.last_attempt_at||row.last_attempt_at>existing.last_attempt_at)){existing.last_attempt_at=row.last_attempt_at;existing.last_attempt_channel=row.last_attempt_channel;existing.last_attempt_status=row.last_attempt_status}
  }
  else map.set(row.client_id,{client_id:row.client_id,client_number:row.client_number,client_name:row.client_name,sales:[withItem],total:row.amount,last_message_copied_at:row.last_message_copied_at,message_copied_count:row.message_copied_count,owner_name:row.owner_name,due_date:row.due_date,last_attempt_channel:row.last_attempt_channel,last_attempt_status:row.last_attempt_status,last_attempt_at:row.last_attempt_at})
 }
 return[...map.values()].sort((a,b)=>a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'}))
}

function TemplatePicker({templates,value,onChange}:{templates:CollectionMessageTemplate[];value:string;onChange:(id:string)=>void}){
 if(templates.length<=1)return null
 return<label className="collections-template-picker"><span>Template</span>
  <select value={value} onChange={e=>onChange(e.target.value)}>{templates.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select>
 </label>
}

function defaultTemplateId(templates:CollectionMessageTemplate[]):string{
 return templates.find(t=>t.key==='cobranca_inicial')?.id??templates[0]?.id??''
}

function CopyMessageModal({group,templates,onClose,onCopied}:{group:ClientGroup;templates:CollectionMessageTemplate[];onClose:()=>void;onCopied:()=>void}){
 const toast=useToast()
 const[templateId,setTemplateId]=useState(()=>defaultTemplateId(templates))
 // text==='' também representa "carregando" (nunca fica vazio de
 // verdade: body do template é NOT NULL/non-blank no banco) — evita
 // manter um segundo estado 'loading' cujo setState síncrono dentro do
 // efeito dispararia a regra set-state-in-effect. Trocar de template
 // (TemplatePicker.onChange) já limpa o texto fora do efeito, num
 // handler de evento comum.
 const[text,setText]=useState('')
 const[copying,setCopying]=useState(false)
 const saleIds=useMemo(()=>group.sales.map(s=>s.id),[group])
 const loading=text===''
 useEffect(()=>{
  if(!templateId)return
  let cancelled=false
  renderCollectionTemplate(group.client_id,saleIds,templateId)
   .then(r=>{if(!cancelled)setText(r.body)})
   .catch(reason=>{if(!cancelled)toast.push(reason instanceof Error?reason.message:'Não foi possível montar a mensagem.',{tone:'error'})})
  return()=>{cancelled=true}
 },[templateId,group.client_id,saleIds,toast])
 const copy=async()=>{
  setCopying(true)
  try{
   await navigator.clipboard.writeText(text)
   await logCollectionMessageCopied(group.client_id,{sale_ids:saleIds,template_id:templateId})
   toast.push('MENSAGEM COPIADA',{tone:'success'})
   onCopied();onClose()
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível copiar a mensagem.',{tone:'error'})}
  finally{setCopying(false)}
 }
 return<Modal open onClose={onClose} eyebrow="COBRANÇA" title={`Mensagem para ${group.client_name}`} footer={<><SecondaryButton onClick={onClose}>CANCELAR</SecondaryButton><PrimaryButton loading={copying||loading} disabled={!text} onClick={()=>void copy()} icon={<ClipboardCopy size={15}/>}>COPIAR MENSAGEM</PrimaryButton></>}>
  <p className="collections-copy-hint">Revise o texto antes de copiar — ele é editável. Nenhuma mensagem é enviada automaticamente; o CRM só registra que a mensagem foi copiada.</p>
  <TemplatePicker templates={templates} value={templateId} onChange={id=>{setText('');setTemplateId(id)}}/>
  <textarea className="collections-copy-text" value={loading?'Montando mensagem…':text} onChange={e=>setText(e.target.value)} rows={11} aria-label="Mensagem de cobrança" disabled={loading}/>
 </Modal>
}

/**
 * Baixa a imagem em UM clique — sem preview, sem modal. Monta o card fora
 * da tela (mesmo layout, mesmos dados já em memória — nenhuma nova
 * consulta), captura com html-to-image assim que ele existe no DOM, baixa
 * o PNG e se desmonta. group some do estado do pai (onDone) tanto no
 * sucesso quanto na falha, senão o botão travaria "carregando" para
 * sempre num erro de captura.
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

function SendCollectionButton({group,templates,disabled,onSent}:{group:ClientGroup;templates:CollectionMessageTemplate[];disabled:boolean;onSent:()=>void}){
 const toast=useToast()
 const[sending,setSending]=useState(false)
 const templateId=defaultTemplateId(templates)
 const send=async()=>{
  if(!templateId)return
  setSending(true)
  try{
   const result=await sendCollectionMessage(group.client_id,group.sales.map(s=>s.id),templateId,'email')
   if(result.status==='sent')toast.push('COBRANÇA ENVIADA',{tone:'success'})
   else toast.push(result.errorMessage??'Não foi possível enviar a cobrança.',{tone:result.errorCode==='provider_not_configured'?'info':'error'})
   onSent()
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível enviar a cobrança.',{tone:'error'})}
  finally{setSending(false)}
 }
 return<SecondaryButton icon={<Send size={14}/>} loading={sending} disabled={disabled||!templateId} onClick={()=>void send()}>ENVIAR COBRANÇA</SecondaryButton>
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
 const canSend=useHasPermission('collections.send')
 const canConfigure=useHasPermission('collections.configure')
 const[rows,setRows]=useState<CollectionSaleRow[]>([])
 const[itemLabels,setItemLabels]=useState<Map<string,string>>(new Map())
 const[templates,setTemplates]=useState<CollectionMessageTemplate[]>([])
 const[settingsConfigured,setSettingsConfigured]=useState(true)
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState('')
 const[search,setSearch]=useState('')
 const[filter,setFilter]=useState<CollectionFilter>('all')
 const[copyGroup,setCopyGroup]=useState<ClientGroup|null>(null)
 const[downloadGroup,setDownloadGroup]=useState<ClientGroup|null>(null)
 const[paymentGroup,setPaymentGroup]=useState<ClientGroup|null>(null)

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
  Promise.all([fetchOrganizationCollectionSettings(),fetchCollectionMessageTemplates()])
   .then(([settings,tpls])=>{setSettingsConfigured(Boolean(settings));setTemplates(tpls.filter(t=>t.active))})
   .catch(()=>{})
 },[])

 const allGroups=useMemo(()=>groupByClient(rows,itemLabels),[rows,itemLabels])
 // "VENCIDOS" não existe como filtro à parte de propósito: due_date já
 // aparece por cliente (calculado a partir de organization_collection_
 // settings.default_due_days) — inventar um segundo conceito de atraso
 // duplicaria a mesma informação.
 const visibleGroups=useMemo(()=>allGroups.filter(group=>filter==='all'||(filter==='never_copied'?group.message_copied_count===0:group.message_copied_count>0)),[allGroups,filter])
 const totals={open:rows.reduce((sum,row)=>sum+row.amount,0),clients:allGroups.length,sales:rows.length}

 const reload=()=>void load(search)
 const noTemplates=templates.length===0

 return<div className="page collections-page">
  {copyGroup&&<CopyMessageModal group={copyGroup} templates={templates} onClose={()=>setCopyGroup(null)} onCopied={reload}/>}
  {downloadGroup&&<CollectionImageDownload group={downloadGroup} onDone={()=>setDownloadGroup(null)}/>}
  {paymentGroup&&<RegisterPaymentModal group={paymentGroup} onClose={()=>setPaymentGroup(null)} onPaid={reload}/>}
  <PageHeader eyebrow="MUGÔ ONE" title="Cobranças" description="Clientes com vendas comercialmente pendentes de pagamento."/>
  {(!settingsConfigured||noTemplates)&&canConfigure&&
   <div className="notice collections-settings-hint">
    <span>Configure as formas de pagamento usadas pela sua empresa.</span>
    <SecondaryButton onClick={goToSettings}>CONFIGURAR COBRANÇAS</SecondaryButton>
   </div>}
  <div className="collections-summary">
   <div className="collections-stat collections-stat--primary"><span>TOTAL EM ABERTO</span><strong>{brl(totals.open)}</strong></div>
   <div className="collections-stat"><span>CLIENTES COM PENDÊNCIAS</span><strong>{totals.clients}</strong></div>
   <div className="collections-stat"><span>VENDAS PENDENTES</span><strong>{totals.sales}</strong></div>
  </div>
  <div className="collections-toolbar">
   <label className="collections-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente ou número do cliente"/></label>
   <div className="collections-filter" role="group" aria-label="Filtrar por mensagem copiada">
    <button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>TODOS</button>
    <button className={filter==='never_copied'?'selected':''} onClick={()=>setFilter('never_copied')}>MENSAGEM NUNCA COPIADA</button>
    <button className={filter==='copied'?'selected':''} onClick={()=>setFilter('copied')}>MENSAGEM JÁ COPIADA</button>
   </div>
  </div>
  {error&&<div className="notice"><span>{error}</span></div>}
  {loading?<div className="empty card"><h3>Carregando cobranças…</h3></div>:
   visibleGroups.length===0?<EmptyState icon={CircleDollarSign} title="Nenhuma cobrança pendente" description="Nenhum cliente tem vendas comercialmente pendentes de pagamento no momento."/>:
   <div className="collections-grid">
    {visibleGroups.map(group=><article className="collections-card" key={group.client_id}>
     <header>
      <div><span className="collections-card-number">Nº {clientNumber(group.client_number)}</span><h3>{group.client_name}</h3></div>
      <div className="collections-card-total"><span>EM ABERTO</span><strong>{brl(group.total)}</strong></div>
     </header>
     <p className="collections-card-meta">
      {group.sales.length} venda{group.sales.length===1?'':'s'} pendente{group.sales.length===1?'':'s'}
      {group.due_date&&<> · Vencimento: {shortDate(group.due_date)}</>}
      {group.owner_name&&<> · Responsável: {group.owner_name}</>}
      {' · '}{group.message_copied_count?`Última mensagem copiada: ${formatAt(group.last_message_copied_at!)} · Copiada ${group.message_copied_count}×`:'Mensagem nunca copiada'}
      {group.last_attempt_at&&<> · Canal usado: {CHANNEL_LABEL[group.last_attempt_channel??'']??group.last_attempt_channel} ({group.last_attempt_status==='sent'?'enviada':'falhou'} em {formatAt(group.last_attempt_at)})</>}
     </p>
     <ul className="collections-card-sales">
      {group.sales.map(s=><li key={s.id}><span>{shortDate(s.sale_date)}</span><span>{s.itemLabel}</span><strong>{brl(s.amount)}</strong><span className="collections-card-status">PENDENTE</span></li>)}
     </ul>
     <footer>
     <SecondaryButton icon={<ClipboardCopy size={14}/>} disabled={noTemplates} onClick={()=>setCopyGroup(group)}>COPIAR COBRANÇA</SecondaryButton>
      {canSend&&<SendCollectionButton group={group} templates={templates} disabled={noTemplates} onSent={reload}/>}
      {group.sales.length>0&&<SecondaryButton icon={<Download size={14}/>} loading={downloadGroup?.client_id===group.client_id} disabled={!!downloadGroup&&downloadGroup.client_id!==group.client_id} onClick={()=>setDownloadGroup(group)}>BAIXAR IMAGEM</SecondaryButton>}
      <button className="collections-open-client" onClick={()=>openClient(group.client_id)}><ExternalLink size={14}/>ABRIR CLIENTE</button>
      {canRegisterPayment&&<PrimaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</PrimaryButton>}
     </footer>
    </article>)}
   </div>}
 </div>
}
