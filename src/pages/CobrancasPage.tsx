import{useEffect,useMemo,useRef,useState}from'react'
import{ClipboardCopy,CircleDollarSign,Download,ExternalLink,MessageCircle}from'lucide-react'
import{brl,clientNumber,shortDate,slugify}from'../lib/format'
import{downloadNodeAsPng,renderNodeAsPngBlob}from'../lib/download-image'
import{useHasPermission}from'../lib/PermissionsContext'
import{CollectionSaleRow,fetchCollectionsPending,fetchDaviExcelDistinct,logCollectionMessageCopied,registerCollectionPayment,sendManychatMessage,uploadCollectionImage}from'../lib/records'
import{EmptyState,FormField,Modal,PageHeader,PrimaryButton,SecondaryButton,useToast}from'../components/ui'
import{COLLECTION_IMAGE_PIXEL_RATIO,CollectionSummaryImageCard}from'../components/CollectionSummaryImageCard'
import'./CobrancasPage.css'

type ClientGroup={client_id:string;client_number:number|null;client_name:string;sales:CollectionSaleRow[];total:number;last_message_copied_at:string|null;message_copied_count:number}
type CollectionFilter='all'|'never_copied'|'copied'

const openClient=(clientId:string)=>{history.pushState({},'',`/clientes/${clientId}`);dispatchEvent(new PopStateEvent('popstate'))}
const messageCopiedAt=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value))

function groupByClient(rows:CollectionSaleRow[]):ClientGroup[]{
 const map=new Map<string,ClientGroup>()
 for(const row of rows){
  const existing=map.get(row.client_id)
  if(existing){existing.sales.push(row);existing.total+=row.amount}
  else map.set(row.client_id,{client_id:row.client_id,client_number:row.client_number,client_name:row.client_name,sales:[row],total:row.amount,last_message_copied_at:row.last_message_copied_at,message_copied_count:row.message_copied_count})
 }
 return[...map.values()].sort((a,b)=>a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'}))
}

const buildMessage=(group:ClientGroup)=>
 `Bi biiiiiiii 🚗💨✨\nO carrinho da cobrança da Ruah passando por aqui!\n\nSeu pedido está reservado e só falta o sinal verde para seguirmos com a separação. 🤍\nConfere pra mim se está tudo certinho?\n\n💰 Total: ${brl(group.total)}\n\n🔑 PIX (CNPJ) — GI Cosméticos LTDA\n67.819.967/0001-70\n\n💳 Prefere cartão? Me fala em quantas vezes quer parcelar que preparo o link.\n\nDepois do pagamento, me envia o comprovante por aqui para eu agilizar a separação. 📦✨\n\nObrigada por escolher a Ruah Parfums! 🤍`

function CopyMessageModal({group,onClose,onCopied}:{group:ClientGroup;onClose:()=>void;onCopied:()=>void}){
 const toast=useToast(),[text,setText]=useState(()=>buildMessage(group)),[copying,setCopying]=useState(false)
 const copy=async()=>{
  setCopying(true)
  try{
   await navigator.clipboard.writeText(text)
   await logCollectionMessageCopied(group.client_id,{sale_ids:group.sales.map(s=>s.id)})
   toast.push('MENSAGEM COPIADA',{tone:'success'})
   onCopied();onClose()
  }catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível copiar a mensagem.',{tone:'error'})}
  finally{setCopying(false)}
 }
 return<Modal open onClose={onClose} eyebrow="COBRANÇA" title={`Mensagem para ${group.client_name}`} footer={<><SecondaryButton onClick={onClose}>CANCELAR</SecondaryButton><PrimaryButton loading={copying} onClick={()=>void copy()} icon={<ClipboardCopy size={15}/>}>COPIAR MENSAGEM</PrimaryButton></>}>
  <p className="collections-copy-hint">Revise o texto antes de copiar — ele é editável. Nenhum WhatsApp é enviado automaticamente; o CRM só registra que a mensagem foi copiada.</p>
  <textarea className="collections-copy-text" value={text} onChange={e=>setText(e.target.value)} rows={11} aria-label="Mensagem de cobrança"/>
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
 const nodeRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  let cancelled=false
  const run=async()=>{
   if(!nodeRef.current)return
   try{
    const name=`cobranca-${slugify(group.client_name)}-${new Date().toISOString().slice(0,10)}.png`
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
 },[group,onDone])
 return<div className="collections-image-offscreen" aria-hidden="true"><CollectionSummaryImageCard ref={nodeRef} group={group}/></div>
}

function CollectionWhatsAppDispatch({group,onSuccess,onError,onDone}:{group:ClientGroup;onSuccess:()=>void;onError:(reason:unknown)=>void;onDone:()=>void}){
 const nodeRef=useRef<HTMLDivElement>(null),callbacks=useRef({onSuccess,onError,onDone})
 useEffect(()=>{
  let cancelled=false
  const run=async()=>{
   if(!nodeRef.current)return
   try{
    const saleIds=group.sales.map(sale=>sale.id),blob=await renderNodeAsPngBlob(nodeRef.current,COLLECTION_IMAGE_PIXEL_RATIO)
    const imageUrl=await uploadCollectionImage(group.client_id,saleIds,blob)
    await sendManychatMessage(group.client_id,'collection',saleIds,imageUrl)
    if(!cancelled)callbacks.current.onSuccess()
   }catch(reason){if(!cancelled)callbacks.current.onError(reason)}
   finally{if(!cancelled)callbacks.current.onDone()}
  }
  void run();return()=>{cancelled=true}
 },[group])
 return<div className="collections-image-offscreen" aria-hidden="true"><CollectionSummaryImageCard ref={nodeRef} group={group}/></div>
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
   {group.sales.map(s=><li key={s.id}><label><input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggle(s.id)}/><span>{shortDate(s.sale_date)} · {s.perfume_name??'Perfume'} · {s.sale_type??'—'} · {s.volume_ml??'—'}ML</span><strong>{brl(s.amount)}</strong></label></li>)}
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
 const toast=useToast()
 const canRegisterPayment=useHasPermission('sales.edit')
 const[rows,setRows]=useState<CollectionSaleRow[]>([])
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState('')
 const[search,setSearch]=useState('')
 const[filter,setFilter]=useState<CollectionFilter>('all')
 const[copyGroup,setCopyGroup]=useState<ClientGroup|null>(null)
 const[downloadGroup,setDownloadGroup]=useState<ClientGroup|null>(null)
 const[paymentGroup,setPaymentGroup]=useState<ClientGroup|null>(null)
 const[whatsappSending,setWhatsappSending]=useState<string|null>(null)
 const[whatsappSent,setWhatsappSent]=useState<Set<string>>(()=>new Set())
 const[whatsappGroup,setWhatsappGroup]=useState<ClientGroup|null>(null)

 const load=(term:string)=>fetchCollectionsPending(term).then(setRows).catch(reason=>setError(reason instanceof Error?reason.message:'Não foi possível carregar as cobranças.')).finally(()=>setLoading(false))
 useEffect(()=>{const timer=setTimeout(()=>{setLoading(true);void load(search)},250);return()=>clearTimeout(timer)},[search])

 const allGroups=useMemo(()=>groupByClient(rows),[rows])
 // "VENCIDOS" não existe aqui de propósito: o único campo de prazo em
 // sales é shipping_deadline (logística de envio), não vencimento
 // financeiro — inferir cobrança em atraso a partir dele inventaria um
 // dado que o sistema não tem.
 const visibleGroups=useMemo(()=>allGroups.filter(group=>filter==='all'||(filter==='never_copied'?group.message_copied_count===0:group.message_copied_count>0)),[allGroups,filter])
 const totals={open:rows.reduce((sum,row)=>sum+row.amount,0),clients:allGroups.length,sales:rows.length}

 const reload=()=>void load(search)
 const sendWhatsapp=(group:ClientGroup)=>{
  if(whatsappSending||whatsappSent.has(group.client_id))return
  setWhatsappSending(group.client_id)
  setWhatsappGroup(group)
 }

 return<div className="page collections-page">
  {copyGroup&&<CopyMessageModal group={copyGroup} onClose={()=>setCopyGroup(null)} onCopied={reload}/>}
  {downloadGroup&&<CollectionImageDownload group={downloadGroup} onDone={()=>setDownloadGroup(null)}/>}
  {whatsappGroup&&<CollectionWhatsAppDispatch group={whatsappGroup} onSuccess={()=>{setWhatsappSent(current=>new Set(current).add(whatsappGroup.client_id));toast.push('WHATSAPP ENVIADO',{tone:'success'})}} onError={reason=>toast.push(reason instanceof Error?reason.message:'Não foi possível enviar o WhatsApp.',{tone:'error'})} onDone={()=>{setWhatsappSending(null);setWhatsappGroup(null)}}/>}
  {paymentGroup&&<RegisterPaymentModal group={paymentGroup} onClose={()=>setPaymentGroup(null)} onPaid={reload}/>}
  <PageHeader eyebrow="RUAH INTELLIGENCE" title="Cobranças" description="Clientes com vendas comercialmente pendentes de pagamento."/>
  <div className="collections-summary">
   <div className="collections-stat collections-stat--primary"><span>TOTAL EM ABERTO</span><strong>{brl(totals.open)}</strong></div>
   <div className="collections-stat"><span>CLIENTES COM PENDÊNCIAS</span><strong>{totals.clients}</strong></div>
   <div className="collections-stat"><span>VENDAS PENDENTES</span><strong>{totals.sales}</strong></div>
  </div>
  <div className="collections-toolbar">
   <label className="collections-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente, número do cliente ou perfume"/></label>
   <div className="collections-filter" role="group" aria-label="Filtrar por mensagem copiada">
    <button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>TODOS</button>
    <button className={filter==='never_copied'?'selected':''} onClick={()=>setFilter('never_copied')}>MENSAGEM NUNCA COPIADA</button>
    <button className={filter==='copied'?'selected':''} onClick={()=>setFilter('copied')}>MENSAGEM JÁ COPIADA</button>
   </div>
  </div>
  {error&&<div className="notice"><span>{error}</span></div>}
  {loading?<div className="empty card"><h3>Carregando cobranças…</h3></div>:
   visibleGroups.length===0?<EmptyState icon={CircleDollarSign} title="Nenhuma cobrança em aberto" description="Nenhum cliente tem vendas comercialmente pendentes de pagamento no momento."/>:
   <div className="collections-grid">
    {visibleGroups.map(group=><article className="collections-card" key={group.client_id}>
     <header>
      <div><span className="collections-card-number">Nº {clientNumber(group.client_number)}</span><h3>{group.client_name}</h3></div>
      <div className="collections-card-total"><span>EM ABERTO</span><strong>{brl(group.total)}</strong></div>
     </header>
     <p className="collections-card-meta">{group.sales.length} venda{group.sales.length===1?'':'s'} pendente{group.sales.length===1?'':'s'} · {group.message_copied_count?`Última mensagem copiada: ${messageCopiedAt(group.last_message_copied_at!)} · Copiada ${group.message_copied_count}×`:'Mensagem nunca copiada'}</p>
     <ul className="collections-card-sales">
      {group.sales.map(s=><li key={s.id}><span>{shortDate(s.sale_date)}</span><span>{s.perfume_name??'Perfume'}</span><span>{s.sale_type??'—'}</span><span>{s.volume_ml??'—'}ML</span><strong>{brl(s.amount)}</strong><span className="collections-card-status">PENDENTE</span></li>)}
     </ul>
     <footer>
     <SecondaryButton icon={<ClipboardCopy size={14}/>} onClick={()=>setCopyGroup(group)}>COPIAR COBRANÇA</SecondaryButton>
      <SecondaryButton icon={<MessageCircle size={14}/>} loading={whatsappSending===group.client_id} disabled={Boolean(whatsappSending)||whatsappSent.has(group.client_id)} onClick={()=>void sendWhatsapp(group)}>{whatsappSent.has(group.client_id)?'WHATSAPP ENVIADO':whatsappSending===group.client_id?'ENVIANDO...':'ENVIAR WHATSAPP'}</SecondaryButton>
      {group.sales.length>0&&<SecondaryButton icon={<Download size={14}/>} loading={downloadGroup?.client_id===group.client_id} disabled={!!downloadGroup&&downloadGroup.client_id!==group.client_id} onClick={()=>setDownloadGroup(group)}>BAIXAR IMAGEM DO PEDIDO</SecondaryButton>}
      <button className="collections-open-client" onClick={()=>openClient(group.client_id)}><ExternalLink size={14}/>ABRIR CLIENTE</button>
      {canRegisterPayment&&<PrimaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</PrimaryButton>}
     </footer>
    </article>)}
   </div>}
 </div>
}
