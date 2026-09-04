import{useMemo,useRef,useState}from'react'
import{AlertTriangle,CheckCircle2,ChevronRight,FileSpreadsheet,LoaderCircle,ShieldCheck,Upload,XCircle}from'lucide-react'
import{analyzeDaviFile,DaviDiagnosticReport,DaviDiagnosticRow,safeDaviRows}from'../lib/davi-import-diagnostics'
import{useToast}from'./ui'
import'./DaviImportDiagnostics.css'

const money=(value:number|null)=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value)
const date=(value:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR'):'—'
const confidence=(value:number)=>`${Math.round(value*100)}%`

function SourceFields({row}:{row:DaviDiagnosticRow}){return <dl><div><dt>Cliente</dt><dd>{row.client||'—'}</dd></div><div><dt>Perfume</dt><dd>{row.perfume||'—'}</dd></div><div><dt>Data</dt><dd>{date(row.date)}</dd></div><div><dt>Tipo</dt><dd>{row.type?.toUpperCase()||'—'}</dd></div><div><dt>ML</dt><dd>{row.ml??'—'}</dd></div><div><dt>Valor</dt><dd>{money(row.amount)}</dd></div></dl>}

function ReviewRows({rows,kind}:{rows:DaviDiagnosticRow[];kind:'duplicate'|'perfume'|'value'|'invalid'}){
 return <div className="davi-diagnostic-list">{rows.map(row=><article key={`${kind}-${row.source_row}`}>
  <header><strong>Linha {row.source_row}</strong><span>{row.reason}</span>{row.confidence>0&&<small>Confiança {confidence(row.confidence)}</small>}</header>
  <div className="davi-diagnostic-compare"><section><h5>PLANILHA</h5><SourceFields row={row}/></section>{kind!=='invalid'&&<section><h5>CRM</h5>{row.existing_matches?.length?row.existing_matches.map(candidate=><dl key={candidate.sale_id}><div><dt>Venda candidata</dt><dd>{candidate.sale_id.slice(0,8)}…</dd></div><div><dt>Cliente</dt><dd>{candidate.client}</dd></div><div><dt>Perfume</dt><dd>{candidate.perfume}</dd></div><div><dt>Data</dt><dd>{date(candidate.date)}</dd></div><div><dt>Tipo / ML</dt><dd>{candidate.type.toUpperCase()} · {candidate.ml} ml</dd></div><div><dt>Valor</dt><dd>{money(candidate.amount)}</dd></div></dl>):<p>Nenhuma venda candidata inequívoca.</p>}</section>}</div>
  <footer><b>Ação recomendada:</b> deixar para revisão. Nenhuma alteração automática será feita.</footer>
 </article>)}</div>
}

function Metric({tone,label,value}:{tone:'ok'|'new'|'warn'|'bad';label:string;value:number}){return <div className={`davi-diagnostic-metric ${tone}`}><strong>{value.toLocaleString('pt-BR')}</strong><span>{label}</span></div>}

export function DaviImportDiagnostics(){
 const toast=useToast(),input=useRef<HTMLInputElement>(null),[file,setFile]=useState<File|null>(null),[report,setReport]=useState<DaviDiagnosticReport|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
 const groups=useMemo(()=>{const rows=report?.rows??[];return{duplicates:rows.filter(row=>row.identity_classification==='PROBABLE_DUPLICATE'),perfume:rows.filter(row=>row.identity_classification==='CONFLICT'&&row.reason.toLowerCase().includes('perfume')),value:rows.filter(row=>row.identity_classification==='CONFLICT'&&row.reason.toLowerCase().includes('valor')),otherConflicts:rows.filter(row=>row.identity_classification==='CONFLICT'&&!/perfume|valor/i.test(row.reason)),invalid:rows.filter(row=>row.identity_classification==='INVALID')}},[report])
 const safe=report?safeDaviRows(report):[]
 const analyze=async()=>{if(!file)return;setLoading(true);setError('');setReport(null);try{const result=await analyzeDaviFile(file);setReport(result);toast.push(`${result.total_lines.toLocaleString('pt-BR')} linhas analisadas sem alterar o CRM.`,{tone:'success'})}catch(reason){const message=reason instanceof Error?reason.message:'Não foi possível analisar a planilha.';setError(message);toast.push(message,{tone:'error'})}finally{setLoading(false)}}
 return <section className="davi-diagnostic" aria-label="Análise da planilha do Davi">
  <header><div><span>IMPORTAÇÃO SEGURA</span><h2>Análise da planilha</h2><p>Envie o arquivo, revise o diagnóstico e só depois aplique itens seguros.</p></div><FileSpreadsheet/></header>
  <div className="davi-diagnostic-upload"><input ref={input} type="file" accept=".csv,.xlsx" onChange={event=>{setFile(event.target.files?.[0]??null);setReport(null);setError('')}}/><button type="button" onClick={()=>input.current?.click()}><Upload/> {file?'TROCAR ARQUIVO':'SELECIONAR PLANILHA'}</button><span>{file?.name??'Nenhum arquivo selecionado'}</span><button className="primary" type="button" disabled={!file||loading} onClick={()=>void analyze()}>{loading?<LoaderCircle className="spin"/>:<ShieldCheck/>}{loading?'ANALISANDO…':'ANALISAR PLANILHA'}</button></div>
  {error&&<p className="davi-diagnostic-error"><XCircle/>{error}</p>}
  {report&&<div className="davi-diagnostic-results">
   <div className="davi-diagnostic-heading"><div><span>ANÁLISE CONCLUÍDA</span><h3>{report.total_lines.toLocaleString('pt-BR')} linhas analisadas</h3><p>{safe.length?`${safe.length} alteração(ões) segura(s) aguardando confirmação.`:`Esta planilha não tem nenhuma alteração segura nova para aplicar. Existem ${report.stock.excluded_for_manual_review} itens para revisão.`}</p></div><CheckCircle2/></div>
   <div className="davi-diagnostic-metrics"><Metric tone="ok" value={report.identity.updates} label="vendas já conciliadas"/><Metric tone="new" value={report.identity.new_sales} label="vendas novas"/><Metric tone="ok" value={report.identity.updates_with_changes} label="atualizações seguras"/><Metric tone="warn" value={report.identity.probable_duplicates} label="possíveis duplicidades"/><Metric tone="warn" value={report.identity.conflicts} label="conflitos"/><Metric tone="bad" value={report.identity.invalid} label="linhas inválidas"/></div>
   <div className="davi-diagnostic-stock"><h4>ESTOQUE</h4>{report.stock.stock_ok.sales===0&&report.stock.stock_insufficient.sales===0&&report.stock.stock_item_missing.sales===0?<p><CheckCircle2/> Nenhuma nova demanda de estoque neste arquivo.</p>:<div className="davi-diagnostic-metrics"><Metric tone="ok" value={report.stock.stock_ok.sales} label={`${report.stock.stock_ok.ml} ml com estoque`}/><Metric tone="warn" value={report.stock.stock_insufficient.sales} label={`${report.stock.stock_insufficient.ml} ml insuficientes`}/><Metric tone="bad" value={report.stock.stock_item_missing.sales} label={`${report.stock.stock_item_missing.ml} ml sem item físico`}/></div>}
    {report.inventory_by_perfume.length>0&&<details><summary><ChevronRight/>Ver simulação por perfume</summary><div className="davi-diagnostic-inventory">{report.inventory_by_perfume.map(item=><article key={item.inventory_item_id}><strong>{item.perfume}</strong><span>Disponível: {item.available_ml} ml</span><span>Já reservado: {item.already_reserved_ml} ml</span><span>Nova demanda: {item.new_demand_ml} ml</span><b>Saldo projetado: {item.projected_balance_ml} ml</b></article>)}</div></details>}
   </div>
   <div className="davi-diagnostic-groups">
    <details><summary><AlertTriangle/>Possíveis duplicidades <b>{groups.duplicates.length}</b><ChevronRight/></summary><ReviewRows rows={groups.duplicates} kind="duplicate"/></details>
    <details><summary><AlertTriangle/>Conflitos de perfume <b>{groups.perfume.length}</b><ChevronRight/></summary><p className="davi-alias-note">Uma equivalência só poderá virar alias após aprovação administrativa. Similaridade textual nunca cria alias automaticamente.</p><ReviewRows rows={groups.perfume} kind="perfume"/></details>
    <details><summary><AlertTriangle/>Conflitos de valor <b>{groups.value.length}</b><ChevronRight/></summary><ReviewRows rows={groups.value} kind="value"/></details>
    {groups.otherConflicts.length>0&&<details><summary><AlertTriangle/>Outros conflitos <b>{groups.otherConflicts.length}</b><ChevronRight/></summary><ReviewRows rows={groups.otherConflicts} kind="duplicate"/></details>}
    <details><summary><XCircle/>Linhas inválidas <b>{groups.invalid.length}</b><ChevronRight/></summary><ReviewRows rows={groups.invalid} kind="invalid"/></details>
   </div>
   <footer className="davi-diagnostic-actions"><div><strong>{safe.length} item(ns) seguro(s)</strong><span>Duplicidades, conflitos, inválidas e falhas de estoque nunca entram no apply.</span></div><button type="button" disabled title={safe.length?'A integração final com o apply aguarda validação desta tela.':'Nenhuma alteração segura para aplicar.'}>APLICAR ALTERAÇÕES SEGURAS</button></footer>
  </div>}
 </section>
}
