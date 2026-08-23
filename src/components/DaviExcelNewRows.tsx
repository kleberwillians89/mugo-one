import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { EntityCombobox, EntityOption, Modal, useToast } from './ui'
import { createSale, searchClients, searchPerfumes } from '../lib/records'
import './DaviExcelNewRows.css'

type EditableColumn='client'|'date'|'deadline'|'type'|'ml'|'perfume'|'amount'|'payment'|'method'|'paidAt'|'notes'
type ActiveCell={rowId:string;columnKey:EditableColumn}|null
type Draft={
  key:string;client:EntityOption|null;clientText:string;clientCandidates:EntityOption[];date:string;deadline:string
  type:'APC'|'SPLIT';ml:string;perfume:EntityOption|null;perfumeText:string;perfumeCandidates:EntityOption[]
  amount:string;payment:string;method:string;paidAt:string;notes:string;saving:boolean;error:string;ignored?:boolean
}
type PasteReview={rows:Draft[]}|null

const EDITABLE_COLUMNS:EditableColumn[]=['client','date','deadline','type','ml','perfume','amount','payment','method','paidAt','notes']
const today=()=>new Date().toLocaleDateString('pt-BR')
const fresh=():Draft=>({key:crypto.randomUUID(),client:null,clientText:'',clientCandidates:[],date:today(),deadline:'',type:'SPLIT',ml:'',perfume:null,perfumeText:'',perfumeCandidates:[],amount:'',payment:'pending',method:'PIX',paidAt:'',notes:'',saving:false,error:''})
const isoDate=(value:string)=>{const match=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(match){const[,day,month,year]=match,iso=`${year}-${month}-${day}`,date=new Date(`${iso}T12:00:00`);return date.getFullYear()===Number(year)&&date.getMonth()+1===Number(month)&&date.getDate()===Number(day)?iso:null}if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.valueOf())?null:value}return null}
const decimal=(value:string)=>{const clean=value.replace(/R\$|\s/g,'').replace(/\./g,'').replace(',','.');const number=Number(clean);return Number.isFinite(number)?number:null}
const exact=(value:string,label:string)=>value.trim().localeCompare(label.trim(),'pt-BR',{sensitivity:'base'})===0
const draftIssue=(row:Draft)=>{if(!row.client)return row.clientCandidates.length?'Cliente ambíguo.':'Cliente não encontrado.';if(!isoDate(row.date))return'Data inválida.';if(row.deadline&&!isoDate(row.deadline))return'Prazo inválido.';if(!row.perfume)return row.perfumeCandidates.length?'Perfume ambíguo.':'Perfume não encontrado.';if(decimal(row.ml)===null||decimal(row.ml)!<=0)return'ML inválidos.';if(decimal(row.amount)===null||decimal(row.amount)!<0)return'Valor inválido.';if(row.payment==='paid'&&row.paidAt&&!isoDate(row.paidAt))return'Data de pagamento inválida.';return''}
const isTextControl=(target:EventTarget|null):target is HTMLInputElement|HTMLTextAreaElement=>target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement

export function DaviExcelNewRows({onCreated}:{onCreated:()=>Promise<void>|void}){
  const toast=useToast(),root=useRef<HTMLTableSectionElement>(null),editStart=useRef(new Map<string,string>())
  const[drafts,setDrafts]=useState<Draft[]>([fresh()]),[activeCell,setActiveCell]=useState<ActiveCell>(null),[review,setReview]=useState<PasteReview>(null)
  const patch=(key:string,next:Partial<Draft>)=>setDrafts(rows=>rows.map(row=>row.key===key?{...row,...next}:row))
  const clientSearch=useCallback(async(term:string)=>(await searchClients(term)).map(row=>({id:row.id,label:row.name})),[])
  const perfumeSearch=useCallback(async(term:string)=>(await searchPerfumes(term)).map(row=>({id:row.id,label:row.full_name_raw,description:row.brand_house??undefined})),[])
  const focusCell=useCallback((rowId:string,columnKey:EditableColumn)=>{setActiveCell({rowId,columnKey});requestAnimationFrame(()=>{const cell=root.current?.querySelector<HTMLElement>(`[data-row-id="${rowId}"][data-column-key="${columnKey}"]`),control=cell?.querySelector<HTMLElement>('input,select,textarea,button');control?.focus({preventScroll:true});cell?.scrollIntoView({block:'nearest',inline:'nearest'})})},[])
  const moveVertical=(rowId:string,columnKey:EditableColumn,direction:1|-1)=>{const index=drafts.findIndex(row=>row.key===rowId),next=index+direction;if(next<0)return;if(next>=drafts.length){if(direction<0)return;const row=fresh();setDrafts(rows=>[...rows,row]);requestAnimationFrame(()=>focusCell(row.key,columnKey));return}focusCell(drafts[next].key,columnKey)}
  const moveHorizontal=(rowId:string,columnKey:EditableColumn,direction:1|-1)=>{const index=EDITABLE_COLUMNS.indexOf(columnKey),next=index+direction;if(next<0||next>=EDITABLE_COLUMNS.length)return;focusCell(rowId,EDITABLE_COLUMNS[next])}
  const cellValue=(row:Draft,column:EditableColumn)=>column==='client'?row.client?.label??row.clientText:column==='perfume'?row.perfume?.label??row.perfumeText:String(row[column]??'')
  const restoreCell=(row:Draft,column:EditableColumn)=>{const value=editStart.current.get(`${row.key}:${column}`);if(value===undefined)return;if(column==='client')patch(row.key,{client:null,clientText:value});else if(column==='perfume')patch(row.key,{perfume:null,perfumeText:value});else patch(row.key,{[column]:value} as Partial<Draft>)}
  const beginEdit=(row:Draft,column:EditableColumn)=>{setActiveCell({rowId:row.key,columnKey:column});editStart.current.set(`${row.key}:${column}`,cellValue(row,column))}
  const save=async(row:Draft)=>{const error=draftIssue(row);if(error){patch(row.key,{error});return false}patch(row.key,{saving:true,error:''});try{await createSale({clientId:row.client!.id,perfumeId:row.perfume!.id,date:isoDate(row.date)!,shippingDeadlineDate:row.deadline?isoDate(row.deadline)!:undefined,shippingDeadlineRaw:row.deadline||undefined,saleType:row.type,volumeMl:decimal(row.ml)!,amount:decimal(row.amount)!,status:row.payment,method:row.method,paidAt:row.payment==='paid'&&row.paidAt?isoDate(row.paidAt)!:undefined,notes:row.notes,source:'davi_excel',idempotencyKey:row.key});setDrafts(rows=>rows.filter(item=>item.key!==row.key));toast.push('Venda adicionada.',{tone:'success'});await onCreated();return true}catch(reason){patch(row.key,{saving:false,error:reason instanceof Error?reason.message:'Não foi possível salvar a venda.'});return false}}
  const saveAll=async()=>{for(const row of drafts)if(!draftIssue(row))await save(row)}
  const resolveRow=async(values:string[])=>{const row=fresh(),editable=values.length<=11,client=values[0],date=values[1],deadline=values[2],type=values[editable?3:4],ml=values[editable?4:5],perfume=values[editable?5:6],amount=values[editable?6:7],payment=values[editable?7:8],method=values[editable?8:9],paidAt=values[editable?9:10],notes=values[editable?10:12];row.clientText=client??'';row.date=date||today();row.deadline=deadline??'';row.type=String(type).toUpperCase()==='APC'?'APC':'SPLIT';row.ml=ml??'';row.perfumeText=perfume??'';row.amount=amount??'';row.payment=({PAGO:'paid',AGUARDANDO:'pending',CANCELADO:'cancelled',REVISÃO:'unknown'}[String(payment).trim().toUpperCase()]??'pending');row.method=method||'PIX';row.paidAt=paidAt??'';row.notes=notes??'';const[clients,perfumes]=await Promise.all([clientSearch(row.clientText),perfumeSearch(row.perfumeText)]),exactClients=clients.filter(item=>exact(row.clientText,item.label)),exactPerfumes=perfumes.filter(item=>exact(row.perfumeText,item.label));row.clientCandidates=clients;row.perfumeCandidates=perfumes;if(exactClients.length===1)row.client=exactClients[0];if(exactPerfumes.length===1)row.perfume=exactPerfumes[0];row.error=draftIssue(row);return row}
  const acceptDrafts=(rows:Draft[])=>{const accepted=rows.filter(row=>!row.ignored&&!draftIssue(row));setDrafts(current=>[...current.filter(row=>row.client||row.ml||row.perfume||row.amount),...accepted]);setReview(null);toast.push(`${accepted.length} rascunho${accepted.length===1?'':'s'} adicionado${accepted.length===1?'':'s'}. Nada foi salvo ainda.`,{tone:'info'})}
  const paste=async(event:React.ClipboardEvent)=>{const text=event.clipboardData.getData('text');if(!text.includes('\t')&&!text.includes('\n'))return;event.preventDefault();const lines=text.trim().split(/\r?\n/).filter(Boolean),rows=await Promise.all(lines.map(line=>resolveRow(line.split('\t'))));if(rows.length>20){setReview({rows});return}setDrafts(current=>[...current.filter(row=>row.client||row.ml||row.perfume||row.amount),...rows]);toast.push(`${rows.length} linha${rows.length===1?'':'s'} colada${rows.length===1?'':'s'}; revise os vínculos destacados.`,{tone:'info'})}
  const onCellKeyDown=(event:React.KeyboardEvent,row:Draft,column:EditableColumn)=>{
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save(row);return}
    if(event.defaultPrevented)return
    const target=event.target as HTMLElement,combobox=target.getAttribute('role')==='combobox',popover=target.closest('[data-column-key]')?.querySelector('.entity-combobox-popover')
    if(combobox&&popover&&['Enter','ArrowUp','ArrowDown','Escape'].includes(event.key))return
    if(target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return
    if(event.key==='Enter'){event.preventDefault();moveVertical(row.key,column,event.shiftKey?-1:1);return}
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();moveVertical(row.key,column,event.key==='ArrowDown'?1:-1);return}
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      if(isTextControl(target)){const start=target.selectionStart??0,end=target.selectionEnd??0,length=target.value.length;if(start!==end||(event.key==='ArrowLeft'&&start>0)||(event.key==='ArrowRight'&&end<length))return}
      event.preventDefault();moveHorizontal(row.key,column,event.key==='ArrowRight'?1:-1);return
    }
    if(event.key==='Escape'){event.preventDefault();restoreCell(row,column);target.blur()}
  }
  const cellProps=(row:Draft,column:EditableColumn)=>({'data-row-id':row.key,'data-column-key':column,'data-active':activeCell?.rowId===row.key&&activeCell.columnKey===column?'true':undefined,onFocusCapture:()=>beginEdit(row,column),onKeyDown:(event:React.KeyboardEvent)=>onCellKeyDown(event,row,column)})
  const summary=useMemo(()=>reviewSummary(review?.rows??[]),[review])
  useEffect(()=>{if(!review)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setReview(null)};addEventListener('keydown',close);return()=>removeEventListener('keydown',close)},[review])
  return <>
    <table><tbody ref={root} role="rowgroup" aria-label="Novas vendas em rascunho" onPaste={paste}>
      <tr className="davi-new-row-actions"><td colSpan={14}><button type="button" onClick={()=>setDrafts(rows=>[...rows,fresh()])}><Plus/> ADICIONAR LINHA</button><button type="button" onClick={saveAll}><Save/> SALVAR TODAS AS LINHAS VÁLIDAS</button><small>{drafts.length} rascunho{drafts.length===1?'':'s'} local{drafts.length===1?'':'is'}</small></td></tr>
      {drafts.map(row=><tr className="davi-new-row" data-draft-key={row.key} key={row.key}>
        <td {...cellProps(row,'client')}><span className="davi-new-badge">NOVA</span><EntityCombobox label="Cliente" placeholder="Cliente" value={row.client} search={clientSearch} onChange={client=>patch(row.key,{client,clientText:client?.label??'',error:''})} onCreate={()=>window.open('/clientes','_blank')} createLabel={query=>`CADASTRAR CLIENTE “${query}”`}/></td>
        <td {...cellProps(row,'date')}><input aria-label="Data" value={row.date} onChange={e=>patch(row.key,{date:e.target.value})} placeholder="DD/MM/AAAA"/></td>
        <td {...cellProps(row,'deadline')}><input aria-label="Prazo de envio" value={row.deadline} onChange={e=>patch(row.key,{deadline:e.target.value})} placeholder="DD/MM/AAAA"/></td><td className="davi-readonly">—</td>
        <td {...cellProps(row,'type')}><select aria-label="Tipo" value={row.type} onChange={e=>patch(row.key,{type:e.target.value as 'APC'|'SPLIT'})}><option>APC</option><option>SPLIT</option></select></td>
        <td {...cellProps(row,'ml')}><input aria-label="ML" inputMode="decimal" value={row.ml} onChange={e=>patch(row.key,{ml:e.target.value})}/></td>
        <td {...cellProps(row,'perfume')}><EntityCombobox label="Perfume" placeholder="Perfume" value={row.perfume} search={perfumeSearch} onChange={perfume=>patch(row.key,{perfume,perfumeText:perfume?.label??'',error:''})} onCreate={()=>window.open('/estoque','_blank')} createLabel={query=>`CADASTRAR PERFUME “${query}”`}/></td>
        <td {...cellProps(row,'amount')}><input aria-label="Valor" inputMode="decimal" value={row.amount} onChange={e=>patch(row.key,{amount:e.target.value})} placeholder="R$ 0,00"/></td>
        <td {...cellProps(row,'payment')}><select aria-label="Pagamento" value={row.payment} onChange={e=>patch(row.key,{payment:e.target.value,paidAt:e.target.value==='paid'&&!row.paidAt?today():row.paidAt})}><option value="paid">PAGO</option><option value="pending">AGUARDANDO</option><option value="cancelled">CANCELADO</option><option value="unknown">REVISÃO</option></select></td>
        <td {...cellProps(row,'method')}><select aria-label="Forma de pagamento" value={row.method} onChange={e=>patch(row.key,{method:e.target.value})}><option>PIX</option><option>CARTÃO DE CRÉDITO</option><option>DEPÓSITO</option><option>CRÉDITO E PIX</option><option>OUTRO</option></select></td>
        <td {...cellProps(row,'paidAt')}><input aria-label="Data pagamento" disabled={row.payment!=='paid'} value={row.paidAt} onChange={e=>patch(row.key,{paidAt:e.target.value})} placeholder="DD/MM/AAAA"/></td><td className="davi-readonly">—</td>
        <td {...cellProps(row,'notes')}><textarea aria-label="Observação" rows={1} value={row.notes} onChange={e=>patch(row.key,{notes:e.target.value})}/>{row.error&&<small className="davi-draft-error">{row.error}</small>}</td>
        <td><button type="button" disabled={row.saving} onClick={()=>save(row)}><Save/> SALVAR</button><button type="button" aria-label="Remover rascunho" onClick={()=>setDrafts(rows=>rows.filter(item=>item.key!==row.key))}><Trash2/></button></td>
      </tr>)}
    </tbody></table>
    <PasteReviewModal review={review} summary={summary} onChange={rows=>setReview({rows})} onCancel={()=>setReview(null)} onAccept={acceptDrafts}/>
  </>
}

type ReviewSummary=ReturnType<typeof reviewSummary>
function reviewSummary(rows:Draft[]){const active=rows.filter(row=>!row.ignored);return{total:rows.length,valid:active.filter(row=>!draftIssue(row)).length,invalid:active.filter(row=>draftIssue(row)).length,clientMissing:active.filter(row=>!row.client&&!row.clientCandidates.length).length,clientAmbiguous:active.filter(row=>!row.client&&row.clientCandidates.length>0).length,perfumeMissing:active.filter(row=>!row.perfume&&!row.perfumeCandidates.length).length,perfumeAmbiguous:active.filter(row=>!row.perfume&&row.perfumeCandidates.length>0).length,invalidDates:active.filter(row=>!isoDate(row.date)||(row.deadline&&!isoDate(row.deadline))).length,invalidAmounts:active.filter(row=>decimal(row.amount)===null||decimal(row.amount)!<0).length,invalidMl:active.filter(row=>decimal(row.ml)===null||decimal(row.ml)!<=0).length}}
function PasteReviewModal({review,summary,onChange,onCancel,onAccept}:{review:PasteReview;summary:ReviewSummary;onChange:(rows:Draft[])=>void;onCancel:()=>void;onAccept:(rows:Draft[])=>void}){
  const rows=review?.rows??[],problems=rows.filter(row=>!row.ignored&&draftIssue(row))
  const patch=(key:string,next:Partial<Draft>)=>onChange(rows.map(row=>row.key===key?{...row,...next}:row))
  return <Modal open={Boolean(review)} onClose={onCancel} title="REVISAR COLAGEM" eyebrow="DAVI EXCEL" size="lg" footer={<><button type="button" onClick={onCancel}>CANCELAR</button><button type="button" onClick={()=>document.querySelector<HTMLElement>('.davi-paste-problems')?.focus()}>REVISAR PROBLEMAS</button><button type="button" disabled={!summary.valid} onClick={()=>onAccept(rows)}>ADICIONAR {summary.valid} LINHAS VÁLIDAS</button></>}>
    <div className="davi-paste-review"><p><strong>{summary.total} linhas recebidas</strong>. Nenhuma venda foi gravada.</p><dl><div><dt>Linhas válidas</dt><dd>{summary.valid}</dd></div><div><dt>Linhas inválidas</dt><dd>{summary.invalid}</dd></div><div><dt>Clientes não encontrados</dt><dd>{summary.clientMissing}</dd></div><div><dt>Clientes ambíguos</dt><dd>{summary.clientAmbiguous}</dd></div><div><dt>Perfumes não encontrados</dt><dd>{summary.perfumeMissing}</dd></div><div><dt>Perfumes ambíguos</dt><dd>{summary.perfumeAmbiguous}</dd></div><div><dt>Datas inválidas</dt><dd>{summary.invalidDates}</dd></div><div><dt>Valores inválidos</dt><dd>{summary.invalidAmounts}</dd></div><div><dt>ML inválidos</dt><dd>{summary.invalidMl}</dd></div></dl>
      <div className="davi-paste-problems" tabIndex={-1}>{problems.map(row=><article key={row.key}><header><strong>Linha {rows.indexOf(row)+1}</strong><span>{draftIssue(row)}</span><button type="button" onClick={()=>patch(row.key,{ignored:true})}>IGNORAR LINHA</button></header>{!row.client&&<fieldset><legend>CLIENTE: “{row.clientText}”</legend>{row.clientCandidates.length?row.clientCandidates.map(option=><label key={option.id}><input type="radio" name={`client-${row.key}`} onChange={()=>patch(row.key,{client:option,error:''})}/>{option.label}</label>):<p>Nenhuma correspondência exata. Corrija depois na grade.</p>}</fieldset>}{!row.perfume&&<fieldset><legend>PERFUME: “{row.perfumeText}”</legend>{row.perfumeCandidates.length?row.perfumeCandidates.map(option=><label key={option.id}><input type="radio" name={`perfume-${row.key}`} onChange={()=>patch(row.key,{perfume:option,error:''})}/><span>{option.label}{option.description&&<small>{option.description}</small>}</span></label>):<p>Nenhuma correspondência exata. Corrija depois na grade.</p>}</fieldset>}</article>)}</div>
    </div>
  </Modal>
}
