import{useMemo,useRef,useState}from'react'
import{AlertTriangle,CheckCircle2,ChevronRight,Database,FileSpreadsheet,Info,LoaderCircle,RefreshCw,ShieldCheck,Upload,XCircle}from'lucide-react'
import{analyzeCurrentCrmState,analyzeDaviFile,applySafeDaviDiagnostic,CrmFinding,CurrentCrmDiagnostic,DataWarning,DaviDiagnosticReport,DaviDiagnosticRow,DaviRowDivergence,incompleteDaviRows,safeDaviRows}from'../lib/davi-import-diagnostics'
import{dateTime,shortDate}from'../lib/format'
import{useToast}from'./ui'
import'./DaviImportDiagnostics.css'

const money=(value:number|null)=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value)
const divergenceCategoryLabel:Record<DaviRowDivergence['category'],string>={MATCHED_SAME_AMOUNT:'Mesmo valor',MATCHED_DIFFERENT_AMOUNT:'Valor divergente',SPREADSHEET_ONLY:'Só na planilha',DUPLICATE_CANDIDATE:'Possível duplicidade',CRM_ONLY:'Só no CRM',INVALID:'Linha inválida'}

function DataWarnings({warnings}:{warnings:DataWarning[]}){
 if(!warnings.length)return null
 return <div className="davi-data-warnings">{warnings.map(warning=><p key={warning.table}><AlertTriangle/><span><b>{warning.table}</b> indisponível nesta leitura (opcional — a análise continuou). {warning.message}{warning.code?` (code: ${warning.code})`:''}</span></p>)}</div>
}

function TotalsReconciliation({totals}:{totals:DaviDiagnosticReport['totals']}){
 const hasDifference=Math.abs(totals.differences.spreadsheet_vs_corresponding)>=0.01
 const visibleDivergences=totals.divergences.filter(row=>row.category!=='MATCHED_SAME_AMOUNT')
 const category=(name:DaviRowDivergence['category'])=>totals.categories[name]
 return <div className="davi-totals">
  <div className="davi-totals-headline">
   <div><span>TOTAL DA PLANILHA</span><strong>{money(totals.spreadsheet.gross_sum)}</strong></div>
   <div><span>TOTAL CORRESPONDENTE NO CRM</span><strong>{money(totals.crm.corresponding.sum)}</strong><small>{totals.crm.corresponding.count.toLocaleString('pt-BR')} vendas com correspondência individual inequívoca</small></div>
   <div className={hasDifference?'davi-totals-diff bad':'davi-totals-diff ok'}><span>DIFERENÇA EXATA</span><strong>{money(totals.differences.spreadsheet_vs_corresponding)}</strong><small>Planilha − CRM correspondente</small></div>
  </div>
  <div className="davi-totals-overall"><span>Total geral ativo exibido pelo CRM: <b>{money(totals.crm.overview.total_general.sum)}</b></span><span>Planilha − total geral do CRM: <b>{money(totals.differences.spreadsheet_vs_total_crm)}</b></span></div>
  {hasDifference&&<details className="davi-totals-divergences"><summary><ChevronRight/>VER DIVERGÊNCIAS<b>{totals.divergences.length}</b></summary>
   <div className="davi-totals-explanation">
    <p><b>Fechamento 1 — Planilha versus CRM correspondente</b></p>
    <p>{money(totals.spreadsheet.gross_sum)} − {money(totals.crm.corresponding.sum)} = {money(totals.differences.spreadsheet_vs_corresponding)}</p>
    <dl>
     <div><dt>MATCHED_DIFFERENT_AMOUNT: diferença planilha − CRM</dt><dd>{money(category('MATCHED_DIFFERENT_AMOUNT').difference)}</dd></div>
     <div><dt>SPREADSHEET_ONLY: valor presente apenas na planilha</dt><dd>{money(category('SPREADSHEET_ONLY').spreadsheet_sum)}</dd></div>
     <div><dt>DUPLICATE_CANDIDATE: valor da planilha ainda sem match confirmado</dt><dd>{money(category('DUPLICATE_CANDIDATE').spreadsheet_sum)}</dd></div>
     <div><dt>INVALID: valor contabilizado em linhas inválidas</dt><dd>{money(category('INVALID').spreadsheet_sum)}</dd></div>
     <div><dt><b>Soma dos componentes</b></dt><dd>{money(totals.bridges.spreadsheet_vs_corresponding)}</dd></div>
    </dl>
    <p><b>Fechamento 2 — Planilha versus total geral ativo do CRM</b></p>
    <p>{money(totals.spreadsheet.gross_sum)} − {money(totals.crm.overview.total_general.sum)} = {money(totals.differences.spreadsheet_vs_total_crm)}</p>
    <dl>{(['MATCHED_SAME_AMOUNT','MATCHED_DIFFERENT_AMOUNT','SPREADSHEET_ONLY','DUPLICATE_CANDIDATE','INVALID','CRM_ONLY']as const).map(name=><div key={name}><dt>{name}: {category(name).count} registro(s) na planilha / {category(name).crm_count} no CRM</dt><dd>{money(category(name).spreadsheet_sum)} − {money(category(name).crm_sum)} = {money(category(name).difference)}</dd></div>)}<div><dt><b>Soma de todas as categorias</b></dt><dd>{money(totals.bridges.spreadsheet_vs_total_crm)}</dd></div></dl>
    {(!totals.reconciles.spreadsheet_vs_corresponding||!totals.reconciles.spreadsheet_vs_total_crm)&&<p className="davi-totals-note bad"><AlertTriangle/>A composição não bateu com a diferença calculada — reveja as divergências antes de confiar neste resumo.</p>}
   </div>
   <div className="davi-totals-list">{visibleDivergences.map((row,index)=><article key={`${row.category}-${row.source_row??'crm'}-${row.sale_id??index}`}>
    <header><span>{divergenceCategoryLabel[row.category]}</span>{row.source_row!=null&&<b>Linha {row.source_row}</b>}</header>
    <p>{row.client||'—'} · {row.perfume||'—'}</p>
    <div className="davi-totals-list-amounts"><span>Planilha: {money(row.spreadsheet_amount)}</span><span>CRM: {money(row.crm_amount)}</span>{row.difference!=null&&<span>Diferença: {money(row.difference)}</span>}</div>
    <small>{row.reason}</small>
   </article>)}</div>
  </details>}
  <details className="davi-totals-status"><summary><ChevronRight/>Quebra por status na planilha</summary><dl>
   {Object.entries(totals.spreadsheet.by_status).map(([status,agg])=><div key={status}><dt>{status}</dt><dd>{agg.count.toLocaleString('pt-BR')} linha(s) · {money(agg.sum)}</dd></div>)}
   <div><dt>Sem valor</dt><dd>{totals.spreadsheet.lines_without_value.toLocaleString('pt-BR')} linha(s)</dd></div>
   <div><dt>Valor inválido</dt><dd>{totals.spreadsheet.lines_invalid_value.toLocaleString('pt-BR')} linha(s)</dd></div>
   <div><dt>Possíveis duplicidades</dt><dd>{totals.spreadsheet.duplicate_value_candidates.toLocaleString('pt-BR')}</dd></div>
  </dl></details>
 </div>
}
const confidence=(value:number)=>`${Math.round(value*100)}%`
const displayStructuredDates=(value:unknown):unknown=>Array.isArray(value)?value.map(displayStructuredDates):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,displayStructuredDates(item)])):typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)?dateTime(value):typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?shortDate(value):value

function SourceFields({row}:{row:DaviDiagnosticRow}){return <dl><div><dt>Cliente</dt><dd>{row.client||'—'}</dd></div><div><dt>Perfume</dt><dd>{row.perfume||'—'}</dd></div><div><dt>Data</dt><dd>{shortDate(row.date)}</dd></div><div><dt>Tipo</dt><dd>{row.type?.toUpperCase()||'—'}</dd></div><div><dt>ML</dt><dd>{row.ml??'—'}</dd></div><div><dt>Valor</dt><dd>{money(row.amount)}</dd></div></dl>}

function ReviewRows({rows,kind}:{rows:DaviDiagnosticRow[];kind:'duplicate'|'perfume'|'value'|'invalid'}){
 return <div className="davi-diagnostic-list">{rows.map(row=><article key={`${kind}-${row.source_row}`}>
  <header><strong>Linha {row.source_row}</strong><span>{row.reason}</span>{row.confidence>0&&<small>Confiança {confidence(row.confidence)}</small>}</header>
  <div className="davi-diagnostic-compare"><section><h5>PLANILHA</h5><SourceFields row={row}/></section>{kind!=='invalid'&&<section><h5>CRM</h5>{row.existing_matches?.length?row.existing_matches.map(candidate=><dl key={candidate.sale_id}><div><dt>Venda candidata</dt><dd>{candidate.sale_id.slice(0,8)}…</dd></div><div><dt>Cliente</dt><dd>{candidate.client}</dd></div><div><dt>Perfume</dt><dd>{candidate.perfume}</dd></div><div><dt>Data</dt><dd>{shortDate(candidate.date)}</dd></div><div><dt>Tipo / ML</dt><dd>{candidate.type.toUpperCase()} · {candidate.ml} ml</dd></div><div><dt>Valor</dt><dd>{money(candidate.amount)}</dd></div></dl>):<p>Nenhuma venda candidata inequívoca.</p>}</section>}</div>
  <footer><b>Ação recomendada:</b> deixar para revisão. Nenhuma alteração automática será feita.</footer>
 </article>)}</div>
}

function Metric({tone,label,value}:{tone:'ok'|'new'|'warn'|'bad';label:string;value:number}){return <div className={`davi-diagnostic-metric ${tone}`}><strong>{value.toLocaleString('pt-BR')}</strong><span>{label}</span></div>}

const severityTone:Record<CrmFinding['severity'],'bad'|'warn'|'new'|'ok'>={CRITICAL:'bad',WARNING:'warn',REVIEW:'warn',INFO:'new'}
function FindingList({findings}:{findings:CrmFinding[]}){return <div className="davi-current-findings">{findings.map(item=><article key={item.id} data-severity={item.severity}><header><span>{item.severity}</span><code>{item.code}</code>{item.sale_id&&<small>Venda {item.sale_id.slice(0,8)}…</small>}</header><h5>{item.title}</h5><p>{item.reason}</p><details><summary>Ver dados estruturados</summary><div><section><b>Esperado</b><pre>{JSON.stringify(displayStructuredDates(item.expected),null,2)}</pre></section><section><b>Encontrado</b><pre>{JSON.stringify(displayStructuredDates(item.actual),null,2)}</pre></section></div></details></article>)}</div>}

export function DaviImportDiagnostics({onApplied=async()=>{}}:{onApplied?:()=>void|Promise<void>}){
 const toast=useToast(),input=useRef<HTMLInputElement>(null),[file,setFile]=useState<File|null>(null),[report,setReport]=useState<DaviDiagnosticReport|null>(null),[loading,setLoading]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState(''),[current,setCurrent]=useState<CurrentCrmDiagnostic|null>(null),[currentLoading,setCurrentLoading]=useState(false),[currentError,setCurrentError]=useState(''),[diagnosticOpen,setDiagnosticOpen]=useState(false)
 const groups=useMemo(()=>{const rows=report?.rows??[];return{duplicates:rows.filter(row=>row.identity_classification==='PROBABLE_DUPLICATE'),perfume:rows.filter(row=>row.identity_classification==='CONFLICT'&&row.reason.toLowerCase().includes('perfume')),value:rows.filter(row=>row.identity_classification==='CONFLICT'&&row.reason.toLowerCase().includes('valor')),otherConflicts:rows.filter(row=>row.identity_classification==='CONFLICT'&&!/perfume|valor/i.test(row.reason)),invalid:rows.filter(row=>row.identity_classification==='INVALID')}},[report])
    const safe=report?safeDaviRows(report):[],incomplete=report?incompleteDaviRows(report):[]
 const analyze=async()=>{if(!file)return;setLoading(true);setError('');setReport(null);try{const result=await analyzeDaviFile(file);setReport(result);toast.push(`${result.total_lines.toLocaleString('pt-BR')} linhas analisadas sem alterar o CRM.`,{tone:'success'})}catch(reason){const message=reason instanceof Error?reason.message:'Não foi possível analisar a planilha.';setError(message);toast.push(message,{tone:'error'})}finally{setLoading(false)}}
 const applySafe=async()=>{if(!file||!report||!safe.length)return;setApplying(true);setError('');try{const result=await applySafeDaviDiagnostic(report);await onApplied();const refreshed=await analyzeDaviFile(file);setReport(refreshed);toast.push(`${result.applied.toLocaleString('pt-BR')} alterações aplicadas com sucesso`,{tone:'success',duration:6500})}catch(reason){const raw=reason instanceof Error?reason.message:'Não foi possível aplicar as alterações.';const conflict=raw.match(/davi_safe_apply_conflict:\{.*?"code":"([^"]+)".*?\}/);if(conflict){setReport(null);const message='A base mudou desde a análise. O diagnóstico foi atualizado automaticamente. Confira os novos resultados antes de aplicar.';setError(message);toast.push(message,{tone:'error',duration:7000});try{const refreshed=await analyzeDaviFile(file);setReport(refreshed)}catch(refreshReason){const refreshMessage=refreshReason instanceof Error?refreshReason.message:'Não foi possível atualizar o diagnóstico.';setError(`${message} ${refreshMessage}`)}}else{setError(raw);toast.push(raw,{tone:'error',duration:7000})}}finally{setApplying(false)}}
 const verifyCurrent=async()=>{setCurrentLoading(true);setCurrentError('');try{const result=await analyzeCurrentCrmState();setCurrent(result);toast.push('Diagnóstico atual concluído sem alterar o CRM.',{tone:'success'})}catch(reason){const message=reason instanceof Error?reason.message:'Não foi possível verificar o CRM.';setCurrentError(message);toast.push(message,{tone:'error'})}finally{setCurrentLoading(false)}}
 const currentGroups=useMemo(()=>{const findings=current?.findings??[];return{duplicates:findings.filter(item=>item.category==='duplicates'),perfumes:findings.filter(item=>item.category==='perfumes'),inventory:findings.filter(item=>item.category==='inventory'),references:findings.filter(item=>item.category==='references'),commercial:findings.filter(item=>item.category==='commercial')}},[current])
 return <section className={`davi-diagnostic ${diagnosticOpen?'is-open':''}`} aria-label="Diagnóstico operacional do Davi Excel">
  <header><div><span>CONSISTÊNCIA DO CRM</span><h2>Diagnóstico operacional</h2><p>{report?`${safe.length} prontas para aplicar · ${incomplete.length} requerem nova análise`:'Verifique a base atual ou analise uma nova planilha.'}</p></div><button type="button" className="davi-diagnostic-toggle" onClick={()=>setDiagnosticOpen(value=>!value)}>{diagnosticOpen?'OCULTAR DIAGNÓSTICO':'VER DIAGNÓSTICO'} <ChevronRight className={diagnosticOpen?'turn':''}/></button><Database/></header>
  <section className="davi-current-check"><div><span>CRM ATUAL</span><h3>Verificar inconsistências</h3><p>Analisa vendas, referências, perfumes, estoque, alocações e operações atuais — sem upload.</p>{current&&<small>Última verificação: {dateTime(current.created_at)}</small>}</div><button className="primary" type="button" disabled={currentLoading} onClick={()=>void verifyCurrent()}>{currentLoading?<LoaderCircle className="spin"/>:<RefreshCw/>}{currentLoading?'VERIFICANDO…':'VERIFICAR AGORA'}</button></section>
  {currentError&&<p className="davi-diagnostic-error"><XCircle/>{currentError}</p>}
  {current&&<div className="davi-current-results"><div className="davi-diagnostic-heading"><div><span>DIAGNÓSTICO ATUAL DO CRM</span><h3>Base analisada agora</h3><p>Vendas: {current.analyzed.sales.toLocaleString('pt-BR')} · Clientes: {current.analyzed.clients.toLocaleString('pt-BR')} · Perfumes: {current.analyzed.perfumes.toLocaleString('pt-BR')}</p></div>{current.consistency.changed_during_read?<AlertTriangle/>:<CheckCircle2/>}</div>
   {current.consistency.changed_during_read&&<p className="davi-snapshot-warning"><AlertTriangle/>A base mudou durante a leitura. Execute novamente antes de tomar decisões.</p>}
   <DataWarnings warnings={current.data_warnings}/>
   <div className="davi-diagnostic-metrics davi-severity-metrics"><Metric tone={severityTone.CRITICAL} value={current.severity.CRITICAL} label="críticos"/><Metric tone={severityTone.WARNING} value={current.severity.WARNING} label="alertas"/><Metric tone={severityTone.REVIEW} value={current.severity.REVIEW} label="revisões"/><Metric tone={severityTone.INFO} value={current.severity.INFO} label="informativos"/></div>
   <div className="davi-current-summary"><div><b>DUPLICIDADES</b><span>{current.summary.possible_duplicates} possíveis</span></div><div><b>PERFUMES</b><span>{current.summary.possible_aliases} possíveis aliases</span><span>{current.summary.perfume_conflicts} conflitos</span></div><div><b>ESTOQUE</b><span>{current.summary.sales_without_item} vendas sem item</span><span>{current.summary.paid_without_allocation} pagas sem alocação</span><span>{current.summary.incompatible_allocations} alocações incompatíveis</span><span>{current.summary.perfumes_with_projected_deficit} perfumes com déficit</span></div><div><b>REFERÊNCIAS</b><span>{current.summary.reference_inconsistencies} inconsistências</span></div><div><b>COMERCIAL</b><span>{current.summary.value_conflicts} conflitos de valor</span><span>{current.summary.commercial_incompatibilities} dados incompatíveis</span></div></div>
   <div className="davi-diagnostic-groups"><details><summary><AlertTriangle/>Duplicidades <b>{currentGroups.duplicates.length}</b><ChevronRight/></summary><FindingList findings={currentGroups.duplicates}/></details><details><summary><Info/>Perfumes e aliases <b>{currentGroups.perfumes.length}</b><ChevronRight/></summary><FindingList findings={currentGroups.perfumes}/></details><details><summary><AlertTriangle/>Estoque e alocações <b>{currentGroups.inventory.length}</b><ChevronRight/></summary><FindingList findings={currentGroups.inventory}/></details><details><summary><XCircle/>Referências <b>{currentGroups.references.length}</b><ChevronRight/></summary><FindingList findings={currentGroups.references}/></details><details><summary><AlertTriangle/>Dados comerciais e valores <b>{currentGroups.commercial.length}</b><ChevronRight/></summary><FindingList findings={currentGroups.commercial}/></details>
    <details><summary><ChevronRight/>Simulação agregada por perfume <b>{current.inventory_by_perfume.filter(item=>item.unallocated_demand_ml>0||item.deficit_ml>0).length}</b><ChevronRight/></summary><div className="davi-diagnostic-inventory">{current.inventory_by_perfume.filter(item=>item.unallocated_demand_ml>0||item.deficit_ml>0).map(item=><article key={item.inventory_item_id}><strong>{item.perfume}</strong><span>Disponível: {item.available_ml} ml</span><span>Reservado: {item.reserved_ml} ml</span><span>Demanda não alocada: {item.unallocated_demand_ml} ml</span><b>Saldo projetado: {item.projected_balance_ml} ml</b><span>Déficit: {item.deficit_ml} ml</span></article>)}</div></details>
   </div><p className="davi-readonly-note"><ShieldCheck/>Esse relatório não altera nada. Os códigos estruturados poderão alimentar ações de correção futuras.</p>
  </div>}
  <details className="davi-new-file-analysis"><summary><FileSpreadsheet/>ANALISAR NOVA PLANILHA<ChevronRight/></summary><p>Use esta opção somente quando houver uma nova versão da planilha operacional do Davi.</p><div className="davi-diagnostic-upload"><input ref={input} type="file" accept=".csv,.xlsx" onChange={event=>{setFile(event.target.files?.[0]??null);setReport(null);setError('')}}/><button type="button" onClick={()=>input.current?.click()}><Upload/> {file?'TROCAR ARQUIVO':'SELECIONAR PLANILHA'}</button><span>{file?.name??'Nenhum arquivo selecionado'}</span><button className="primary" type="button" disabled={!file||loading} onClick={()=>void analyze()}>{loading?<LoaderCircle className="spin"/>:<ShieldCheck/>}{loading?'ANALISANDO…':'ANALISAR PLANILHA'}</button></div>
  {error&&<p className="davi-diagnostic-error"><XCircle/>{error}</p>}
  {report&&<div className="davi-diagnostic-results">
   <div className="davi-diagnostic-heading"><div><span>ANÁLISE CONCLUÍDA</span><h3>{report.total_lines.toLocaleString('pt-BR')} linhas analisadas</h3><p>{safe.length?`${safe.length} alteração(ões) segura(s) aguardando confirmação.`:`Esta planilha não tem nenhuma alteração segura nova para aplicar. Existem ${report.stock.excluded_for_manual_review} itens para revisão.`}</p><small>Arquivo: {report.file_name} · SHA-256: {report.source_sha256} · Snapshot: {report.snapshot_created_at}</small></div><CheckCircle2/></div>
   <DataWarnings warnings={report.data_warnings}/>
   <TotalsReconciliation totals={report.totals}/>
   <div className="davi-diagnostic-metrics"><Metric tone="ok" value={report.identity.updates} label="vendas existentes encontradas"/><Metric tone="new" value={report.identity.new_sales} label="vendas novas"/><Metric tone="ok" value={report.identity.updates_with_changes} label="alterações propostas"/><Metric tone="warn" value={report.identity.probable_duplicates} label="possíveis duplicidades"/><Metric tone="warn" value={report.identity.conflicts} label="conflitos"/><Metric tone="bad" value={report.identity.invalid} label="linhas inválidas"/></div>
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
    <footer className="davi-diagnostic-actions"><div><strong>{safe.length} item(ns) seguro(s)</strong><span>{incomplete.length?`${incomplete.length} linha${incomplete.length===1?'':'s'} requer nova análise. `:''}Duplicidades, conflitos, inválidas e falhas de estoque nunca entram no apply.</span></div><button type="button" disabled={!safe.length||applying} onClick={()=>void applySafe()} title={safe.length?'Revalida e aplica atomicamente somente as linhas seguras.':'Nenhuma alteração segura para aplicar.'}>{applying?<><LoaderCircle className="spin"/>APLICANDO...</>:'APLICAR ALTERAÇÕES SEGURAS'}</button></footer>
  </div>}</details>
 </section>
}
