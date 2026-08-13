import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, Bot, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, CircleHelp,
  Boxes, Clock3, Download, FileSpreadsheet, FileText, Home, Import, Lightbulb, LoaderCircle, Menu,
  MoreHorizontal, Plus, RotateCcw, Search, Settings, ShoppingBag, SlidersHorizontal, Sparkles, TrendingUp,
  Truck, UploadCloud, UserRound, UsersRound, X, AlertTriangle, ArrowUpRight,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format, parseISO, subDays } from 'date-fns'
import { brl, integer, shortDate } from './lib/format'
import { ImportPreview, ParsedSale, readWorkbook } from './lib/importer'
import { ClientModal, SaleModal } from './components/RecordModals'
import { PeriodFilter } from './components/PeriodFilter'
import { NewShipmentModal, OperationalShipments, ShipmentDetailsPage, ShippingSettingsPage } from './components/ShipmentOperations'
import { defaultPeriod, PeriodValue } from './lib/period'
import {
  CommercialSale, PeriodSummary, SaleFilters,
  adjustInventory, askIntelligence, confirmLegacyProductCustody, createDraftShipment, createInventoryItem, fetchClient360, fetchClientPeriodSummaries, fetchDeliveryRows, fetchSale360, releaseLegacyProductCustody,
  fetchInventory, fetchLogisticsSummary, fetchOperationalInventory, fetchPeriodSummary, fetchSalesPage, inventoryPerfumes, InventoryRow, InventorySummary, LogisticsSummary, OperationalInventoryRow, updateShipment,
} from './lib/records'

type Page = 'Visão Geral'|'Clientes'|'Vendas'|'Entregas'|'Estoque'|'Relatórios'|'Importação'|'IA'|'Insights'|'Configurações'
const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Clientes', icon: UsersRound },
  { label: 'Vendas', icon: ShoppingBag }, { label: 'Entregas', icon: Truck },
  { label: 'Estoque', icon: Boxes },
  { label: 'Relatórios', icon: FileText }, { label: 'Importação', icon: Import },
  { label: 'IA', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Configurações', icon: Settings },
]
const routes:Record<Page,string>={'Visão Geral':'/','Clientes':'/clientes','Vendas':'/vendas','Entregas':'/entregas','Estoque':'/estoque','Relatórios':'/relatorios','Importação':'/importacao','IA':'/ia','Insights':'/insights','Configurações':'/configuracoes'}
const pageFromPath=()=>location.pathname.startsWith('/clientes/')?'Clientes':location.pathname.startsWith('/vendas/')?'Vendas':location.pathname.startsWith('/entregas/')?'Entregas':Object.entries(routes).find(([,path])=>path===location.pathname)?.[0] as Page||'Visão Geral'

const statusLabel: Record<string, string> = { paid: 'Pago', pending: 'Aguardando', cancelled: 'Cancelado', unknown: 'Desconhecido' }

function Sidebar({ page, setPage, open, close }: { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void }) {
  return <>
    {open && <button className="scrim" aria-label="Fechar menu" onClick={close} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><div><strong>RUAH</strong><span>INTELLIGENCE</span></div></div>
      <nav>{navigation.map(({ label, icon: Icon }) =>
        <button key={label} className={page === label ? 'active' : ''} onClick={() => { setPage(label); close() }}>
          <Icon size={19} /><span>{label}</span>{label === 'IA' && <i>IA</i>}
        </button>)}
      </nav>
      <div className="sidebar-foot">
        <div className="workspace-mark">RP</div>
        <div><strong>RUAH Parfums</strong><span>Administrador</span></div>
        <MoreHorizontal size={18} />
      </div>
    </aside>
  </>
}

function Header({ page, menu }: { page: Page; menu: () => void }) {
  return <header>
    <button className="icon-button mobile-menu" onClick={menu}><Menu size={21} /></button>
    <div><p>CRM E INTELIGÊNCIA COMERCIAL</p><h1>{page}</h1></div>
    <div className="header-actions">
      <button className="icon-button"><CircleHelp size={20} /></button>
      <button className="icon-button notification"><Bell size={20} /><i /></button>
      <span className="avatar">KP</span>
    </div>
  </header>
}

function EmptyConnect({ title, text }: { title: string; text: string }) {
  return <div className="empty card">
    <div className="empty-icon"><ChartNoAxesCombined /></div><h3>{title}</h3><p>{text}</p>
    <button className="primary"><Settings size={17} /> Configurar Supabase</button>
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone = 'gold' }: { label: string; value: string; detail: string; icon: typeof Home; tone?: string }) {
  return <article className="metric card">
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div className="metric-top"><span>{label}</span><button><MoreHorizontal size={17} /></button></div>
    <strong>{value}</strong><small>{detail}</small>
  </article>
}

function Dashboard({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [live,setLive]=useState<PeriodSummary|null>(null)
  const [loadError,setLoadError]=useState('')
  useEffect(()=>{fetchPeriodSummary(period).then(setLive).catch(()=>setLoadError('Não foi possível consultar o Supabase.'))},[period])
  const hasData = Boolean(live?.sales)
  const paid = Number(live?.paid ?? 0)
  const pending = Number(live?.pending ?? 0)
  const cancelled = Number(live?.cancelled ?? 0)
  const total = paid + pending + cancelled
  const paymentData = live?.payment_methods??[]
  const colors = ['#bf9636', '#332f29', '#817768', '#ded6c8', '#9f7c2b']
  return <div className="page">
    <div className="page-lead">
      <div><h2>Visão geral das vendas</h2><p>Acompanhe os principais números da RUAH.</p></div>
      <PeriodFilter value={period} onApply={setPeriod}/>
    </div>
    {loadError && <div className="notice"><AlertTriangle size={18} /><span>{loadError}</span></div>}
    <section className="metrics">
      <Metric label="Vendas realizadas" value={hasData ? integer(Number(live!.sales)) : '—'} detail={period.label} icon={ShoppingBag} />
      <Metric label="Valor total" value={hasData ? brl(Number(live!.total)) : '—'} detail={hasData ? 'Todos os status' : 'Sem dados sincronizados'} icon={TrendingUp} />
      <Metric label="Valor pago" value={hasData ? brl(paid) : '—'} detail={hasData ? `${integer(Number(live!.paid_count))} pagamentos` : 'Aguardando importação'} icon={Check} tone="dark" />
      <Metric label="Aguardando pagamento" value={hasData ? brl(pending) : '—'} detail={hasData ? `${integer(Number(live!.pending_count))} vendas` : 'Aguardando importação'} icon={Clock3} tone="sand" />
      <Metric label="Cancelado" value={hasData ? brl(cancelled) : '—'} detail={hasData ? 'Fora do faturamento' : 'Aguardando importação'} icon={X} tone="cream" />
      <Metric label="Status em revisão" value={hasData ? brl(Number(live!.review)) : '—'} detail={hasData ? `${integer(Number(live!.review_count))} registros` : 'Aguardando importação'} icon={AlertTriangle} tone="cream" />
    </section>
    {hasData && <section className="coverage card">
      <div><span>Ticket médio</span><strong>{brl(Number(live!.average_ticket))}</strong></div>
      <div><span>Clientes compradores</span><strong>{integer(Number(live!.buying_clients))}</strong></div>
      <div><span>Novos clientes</span><strong>{integer(Number(live!.new_clients))}</strong></div>
      <div><span>Clientes recorrentes</span><strong>{integer(Number(live!.recurring_clients))}</strong></div>
      <div><span>Entregas pendentes</span><strong>{integer(Number(live!.deliveries_pending))}</strong></div>
      <div><span>Entregas atrasadas</span><strong>{integer(Number(live!.deliveries_overdue))}</strong></div>
    </section>}
    <section className="dashboard-grid">
      <div className="card chart-card">
        <div className="card-title"><div><h3>Evolução de faturamento</h3><p>Receita mensal da base validada</p></div><span className="live-dot">DADOS REAIS</span></div>
        {hasData ? <ResponsiveContainer width="100%" height={260}><AreaChart data={live!.daily}>
          <defs><linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bf9636" stopOpacity={0.28}/><stop offset="100%" stopColor="#bf9636" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="#eee9e1" vertical={false}/><XAxis dataKey="period_date" tickFormatter={(value)=>shortDate(value)} axisLine={false} tickLine={false}/><YAxis tickFormatter={(v) => `${Math.round(v/1000)}k`} axisLine={false} tickLine={false}/>
          <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(value)=>shortDate(String(value))}/><Area type="monotone" dataKey="paid" stroke="#b68a25" strokeWidth={2.5} fill="url(#goldFill)"/>
        </AreaChart></ResponsiveContainer> : <ChartPlaceholder />}
      </div>
      <div className="card chart-card">
        <div className="card-title"><div><h3>Status dos pagamentos</h3><p>Distribuição do valor comercial</p></div></div>
        {hasData && total ? <div className="payment-chart">
          <ResponsiveContainer width="52%" height={220}><PieChart><Pie data={[{name:'Pago',value:paid},{name:'Aguardando',value:pending},{name:'Cancelado',value:cancelled}]} innerRadius={67} outerRadius={88} dataKey="value" stroke="none">
            {[0,1,2].map((_, i)=><Cell key={i} fill={colors[i]}/>)}</Pie><Tooltip formatter={(v)=>brl(Number(v))}/></PieChart></ResponsiveContainer>
          <div className="legend">{[['Pago',paid],['Aguardando',pending],['Cancelado',cancelled]].map((x,i)=><div key={String(x[0])}><i style={{background:colors[i]}}/><span>{x[0]}</span><strong>{brl(Number(x[1]))}</strong></div>)}</div>
        </div> : <ChartPlaceholder />}
      </div>
      <div className="card chart-card payments">
        <div className="card-title"><div><h3>Formas de pagamento</h3><p>Preferências na base comercial</p></div></div>
        {hasData ? <ResponsiveContainer width="100%" height={235}><BarChart layout="vertical" data={paymentData.slice(0,5)} margin={{left: 15}}>
          <CartesianGrid horizontal={false} stroke="#eee9e1"/><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={125} axisLine={false} tickLine={false} tick={{fontSize:12}}/><Tooltip formatter={(v)=>integer(Number(v))}/>
          <Bar dataKey="value" fill="#b68a25" radius={[0,5,5,0]} barSize={15}/></BarChart></ResponsiveContainer> : <ChartPlaceholder compact />}
      </div>
      <div className="card intelligence-card">
        <div className="ai-orb"><Sparkles size={22}/></div><span>RUAH INTELLIGENCE</span>
        <h3>Uma leitura inteligente da sua operação.</h3>
        <p>{hasData ? `O período possui ${integer(Number(live!.sales))} vendas reais. A IA recebe apenas agregados autorizados.` : 'Quando houver dados no período, a IA encontrará tendências, riscos e oportunidades.'}</p>
        <button>Conversar com a inteligência <ArrowUpRight size={16}/></button>
      </div>
    </section>
  </div>
}

function ChartPlaceholder({ compact = false }: { compact?: boolean }) {
  return <div className={`chart-placeholder ${compact ? 'compact' : ''}`}><ChartNoAxesCombined size={25}/><span>Aguardando dados reais</span></div>
}

function ImportPage() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    try {
      const result = await readWorkbook(file)
      setPreview(result.preview)
    } catch { setError('Não foi possível ler o arquivo. Verifique o formato e tente novamente.') }
    finally { setLoading(false) }
  }
  return <div className="page">
    <div className="page-lead"><div><h2>Importar dados comerciais</h2><p>Valide cada linha antes de levar as vendas ao Supabase.</p></div></div>
    {!preview ? <label className="dropzone">
      <input type="file" accept=".xlsx,.csv" onChange={handleFile}/>
      <div className="upload-icon"><UploadCloud/></div>
      <h3>{loading ? 'Lendo planilha…' : 'Arraste sua planilha ou clique para selecionar'}</h3>
      <p>Arquivos XLSX ou CSV · o arquivo original nunca será alterado</p>
      <span className="primary"><FileSpreadsheet size={17}/> Selecionar arquivo</span>
      {error && <em>{error}</em>}
    </label> : <ImportReview preview={preview} reset={() => setPreview(null)} />}
    <div className="security-note"><div><Check size={17}/></div><p><strong>Importação protegida</strong><span>Nenhuma venda será inserida antes da sua confirmação. Em produção, o arquivo fica em bucket privado.</span></p></div>
  </div>
}

function ImportReview({ preview, reset }: { preview: ImportPreview; reset: () => void }) {
  const [filter, setFilter] = useState<'all'|'valid'|'error'>('all')
  const rows = preview.rows.filter((r) => filter === 'all' || (filter === 'valid' ? r.isAccountable : !r.isAccountable))
  return <div className="import-review">
    <div className="file-line card"><div className="file-icon"><FileSpreadsheet/></div><div><strong>{preview.fileName}</strong><span>{preview.sheets.length} abas · aba selecionada: {preview.selectedSheet}</span></div><button onClick={reset}><X size={18}/></button></div>
    <div className="import-steps"><span className="done"><Check/> Arquivo</span><i/><span className="current">2</span><b>Validar</b><i/><span>3</span><b>Confirmar</b></div>
    <section className="import-stats">
      <div><span>Linhas lidas</span><strong>{integer(preview.totalRows)}</strong></div>
      <div className="success"><span>Importáveis</span><strong>{integer(preview.valid)}</strong></div>
      <div className="danger"><span>Impossíveis</span><strong>{integer(preview.rejected)}</strong></div>
      <div className="warning"><span>Duplicidades</span><strong>{integer(preview.duplicates)}</strong></div>
      <div><span>Clientes</span><strong>{integer(preview.uniqueClients)}</strong></div>
      <div><span>Volume bruto</span><strong>{brl(preview.importedValue)}</strong></div>
    </section>
    <div className="card preview-card">
      <div className="preview-head"><div><h3>Prévia da validação</h3><p>Confira alertas antes de confirmar.</p></div>
        <div className="tabs">{(['all','valid','error'] as const).map((x)=><button className={filter===x?'selected':''} onClick={()=>setFilter(x)} key={x}>{x==='all'?'Todas':x==='valid'?'Válidas':'Revisar'}</button>)}</div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Validação</th></tr></thead>
        <tbody>{rows.slice(0,25).map((r)=><PreviewRow key={r.row} row={r}/>)}</tbody></table></div>
      <div className="table-foot"><span>Exibindo {Math.min(rows.length,25)} de {integer(rows.length)} linhas</span><button className="primary" disabled={preview.valid === 0}>Confirmar linhas válidas <ArrowUpRight size={16}/></button></div>
    </div>
  </div>
}

function PreviewRow({ row }: { row: ParsedSale }) {
  const issues = [...row.blockers, ...row.warnings]
  return <tr><td>{row.row}</td><td><strong>{row.client || '—'}</strong></td><td>{row.date || '—'}</td><td>{row.amount === null ? '—' : brl(row.amount)}</td><td><span className={`badge ${row.paymentStatus}`}>{statusLabel[row.paymentStatus]}</span></td><td>{row.paymentMethod || '—'}</td><td>{issues.length ? <span className="row-error"><AlertTriangle/> {issues.join(', ')}</span> : <span className="row-ok"><Check/> Contabilizável</span>}</td></tr>
}

function Intelligence({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const suggestions = ['Como estão as vendas deste mês?', 'Quanto ainda está aguardando?', 'Quais entregas estão atrasadas?', 'Quais perfumes estão acabando?', 'O que devo repor primeiro?', 'Existem vendas sem estoque suficiente?']
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<Record<string,unknown>|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [lastQuestion,setLastQuestion]=useState(''),[meta,setMeta]=useState<{run_id:string;status:string;retried:boolean;duration_ms:number}|null>(null)
  const [waitingMessage,setWaitingMessage]=useState('')
  const requestActive=useRef(false)
  const analysisRef=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{if(!loading)return;const messages=['Consultando as vendas…','Conferindo pagamentos e clientes…','Organizando as informações…','Preparando um resumo simples…'];let index=0;const interval=window.setInterval(()=>{index+=1;setWaitingMessage(index>=4?'Estamos finalizando sua análise. Só mais um instante.':messages[index])},4000);return()=>window.clearInterval(interval)},[loading])
  useEffect(()=>{if(answer)window.setTimeout(()=>analysisRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80)},[answer])
  const submit=async(text=question)=>{const clean=text.trim();if(!clean||requestActive.current)return;requestActive.current=true;setQuestion(clean);setLastQuestion(clean);setWaitingMessage('Consultando as vendas…');setLoading(true);setError('');setMeta(null);try{const result=await askIntelligence(clean,period);setAnswer(result.answer);setMeta(result.meta);setQuestion('')}catch(err){setError(err instanceof Error?err.message:'A inteligência está indisponível.')}finally{requestActive.current=false;setWaitingMessage('');setLoading(false)}}
  const renderList=(value:unknown)=>Array.isArray(value)?<ul>{value.map((item,index)=><li key={index}>{String(item)}</li>)}</ul>:<p>{String(value??'')}</p>
  const numbers=Array.isArray(answer?.numeros_principais)?answer.numeros_principais as {rotulo:string;valor:string;explicacao:string}[]:[]
  return <div className="page intelligence-page"><div className="page-lead"><div><h2>RUAH Intelligence</h2><p>Análise consultiva baseada apenas em agregados reais.</p></div><PeriodFilter value={period} onApply={setPeriod}/></div>
    <div className="intelligence-hero"><div className="hero-spark"><Sparkles/></div><span>RUAH INTELLIGENCE</span><h2>Decisões mais claras começam<br/>com as perguntas certas.</h2><p>Respostas baseadas exclusivamente nos dados autorizados da sua operação.</p></div>
    <div className="chat-box card">
      {!answer&&!loading?<div className="chat-empty"><Bot/><h3>Como posso ajudar hoje?</h3><p>Escolha uma sugestão ou escreva uma pergunta sobre os dados da RUAH.</p></div>:null}
      {loading&&<div className="ai-waiting" aria-live="polite"><LoaderCircle className="spin"/><div><strong>Estamos analisando os dados da RUAH.</strong><p>Isso pode levar alguns segundos.</p><span>{waitingMessage}</span></div></div>}
      {answer&&!loading&&<div className="ai-answer" ref={analysisRef}><div className="ai-question"><span>Sua pergunta</span><p>{lastQuestion}</p></div><span>Período: {String(answer.periodo_analisado??period.label)}</span><section className="ai-direct"><h4>Resposta direta</h4><h3>{String(answer.resumo??'Análise concluída')}</h3></section>{numbers.length>0&&<section><h4>Números principais</h4><div className="ai-metric-grid">{numbers.map((number,index)=><article key={index}><span>{number.rotulo}</span><strong>{number.valor}</strong><p>{number.explicacao}</p></article>)}</div></section>}{Array.isArray(answer.alertas)&&answer.alertas.length>0&&<section><h4>O que merece atenção</h4>{renderList(answer.alertas)}</section>}{Array.isArray(answer.recomendacoes)&&answer.recomendacoes.length>0&&<section><h4>Recomendações</h4>{renderList(answer.recomendacoes)}</section>}{Array.isArray(answer.proximas_acoes)&&answer.proximas_acoes.length>0&&<section><h4>Próximos passos</h4>{renderList(answer.proximas_acoes)}</section>}{meta&&<small>Análise concluída em {Math.round(meta.duration_ms/1000)} segundos</small>}<button className="ask-again" onClick={()=>{setAnswer(null);setLastQuestion('');window.setTimeout(()=>inputRef.current?.focus(),50)}}>Fazer outra pergunta</button></div>}
      {!answer&&!loading&&<div className="suggestions">{suggestions.map(x=><button key={x} onClick={()=>{setQuestion(x);submit(x)}}>{x}<ArrowUpRight size={14}/></button>)}</div>}
      <div className="chat-input"><textarea ref={inputRef} value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit()}}} maxLength={1000} rows={2} placeholder="Pergunte sobre faturamento, clientes, pagamentos…" disabled={loading}/><button aria-label="Enviar pergunta" title="Enviar pergunta" disabled={loading||!question.trim()} onClick={()=>submit()}>{loading?<><LoaderCircle className="spin"/><span>Analisando…</span></>:<><ArrowUpRight/><span>Enviar</span></>}</button></div>
      {error&&<div className="ai-error"><div className="form-error">{error}</div><button onClick={()=>submit(lastQuestion)} disabled={loading}><RotateCcw/> Tentar novamente</button></div>}
      <small><span className="dot"/> A IA só acessa métricas agregadas e autorizadas</small>
    </div>
  </div>
}

function Insights({period}:{period:PeriodValue}) {
  const [summary,setSummary]=useState<PeriodSummary|null>(null)
  useEffect(()=>{fetchPeriodSummary(period).then(setSummary).catch(()=>setSummary(null))},[period])
  const blocks=summary?[
    ['Pagamentos aguardando',`${integer(summary.pending_count)} vendas · ${brl(Number(summary.pending))}`],
    ['Entregas atrasadas',`${integer(summary.deliveries_overdue)} itens exigem atenção`],
    ['Clientes recorrentes',`${integer(summary.recurring_clients)} clientes no período`],
  ]:[]
  return <div className="page"><div className="page-lead"><div><h2>Insights comerciais</h2><p>Recomendações práticas geradas a partir de métricas oficiais.</p></div><button className="primary"><Sparkles size={17}/> Gerar novos insights</button></div>
    <div className="insight-grid">
      {blocks.map(([title,text],i)=><article className="card insight-skeleton" key={title}><div><span>{title}</span><i>{i===1?'ALTO':'REAL'}</i></div><h3>{text}</h3><p>Calculado diretamente no Supabase para {period.label.toLowerCase()}.</p><footer><Clock3 size={14}/> Atualizado agora</footer></article>)}
    </div>
    {!summary&&<EmptyConnect title="Insights indisponíveis" text="Não foi possível consultar os agregados reais."/>}
  </div>
}

function GenericPage({ page }: { page: Page }) {
  const [modal,setModal]=useState(false)
  const config = {
    Clientes: ['Clientes','Relacionamento, recorrência e histórico em um só lugar.',UserRound],
    Vendas: ['Vendas','Acompanhe cada venda, pagamento e alteração com segurança.',ShoppingBag],
    Configurações: ['Configurações','Organização, membros, integrações e preferências.',Settings],
  }[page as 'Clientes'] as [string,string,typeof Home]
  const Icon = config[2]
  return <div className="page">{modal&&page==='Clientes'&&<ClientModal close={()=>setModal(false)}/>}
    {modal&&page==='Vendas'&&<SaleModal close={()=>setModal(false)}/>}
    <div className="page-lead"><div><h2>{config[0]}</h2><p>{config[1]}</p></div>{page!=='Configurações'&&<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> {page==='Clientes'?'Adicionar cliente':'Adicionar venda'}</button>}</div>
    <div className="toolbar card"><div className="search"><Search size={18}/><input placeholder={`Buscar em ${page.toLowerCase()}…`}/></div><button><CalendarDays size={17}/> Período</button><button><ChevronDown size={16}/> Filtros</button></div>
    <div className="empty card"><div className="empty-icon"><Icon/></div><h3>Nenhum dado sincronizado</h3><p>Conecte o projeto Supabase da RUAH e faça a primeira importação segura.</p><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> {page==='Clientes'?'Adicionar cliente':page==='Vendas'?'Adicionar venda':'Configurar'}</button></div>
  </div>
}

function ClientsPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [modal,setModal]=useState(false)
  const [clients,setClients]=useState<Record<string,unknown>[]>([])
  const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[order,setOrder]=useState('paid')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{fetchClientPeriodSummaries(period).then(setClients).catch(()=>setError('Não foi possível consultar os clientes.')).finally(()=>setLoading(false))},[period])
  const visible=clients.filter((client)=>String(client.client).toLowerCase().includes(search.toLowerCase())&&(!status||client.relationship_status===status))
    .sort((a,b)=>order==='name'?String(a.client).localeCompare(String(b.client),'pt-BR'):Number(b[order])-Number(a[order]))
  return <div className="page">{modal&&<ClientModal close={()=>setModal(false)}/>}
    <div className="page-lead"><div><h2>Clientes</h2><p>Relacionamento, recorrência e histórico no período.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> Adicionar cliente</button></div></div>
    <div className="toolbar card"><div className="search"><Search size={18}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar cliente…"/></div>
      <select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="">Todos os status</option><option value="new">Novo</option><option value="recurring">Recorrente</option><option value="active">Ativo</option><option value="inactive">Inativo</option></select>
      <select value={order} onChange={(event)=>setOrder(event.target.value)}><option value="paid">Maior valor pago</option><option value="total_purchased">Maior valor total</option><option value="item_count">Mais compras</option><option value="average_ticket">Maior ticket</option><option value="name">Nome</option></select></div>
    {loading?<div className="empty card"><h3>Carregando clientes do Supabase…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(visible.length)} clientes</strong><span>Dados reais no período selecionado</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Total</th><th>Pago</th><th>Aguardando</th><th>Compras</th><th>Ticket médio</th><th>Perfume mais comprado</th><th>ML total</th><th>Entregas pendentes</th><th>Status</th><th>Primeira</th><th>Última</th><th>Ação</th></tr></thead>
      <tbody>{visible.map((c)=>{const open=()=>{history.pushState({},'',`/clientes/${c.client_id}`);dispatchEvent(new PopStateEvent('popstate'))};return <tr className="clickable-row" tabIndex={0} key={String(c.client_id)} onClick={open} onKeyDown={(event)=>{if(event.key==='Enter')open()}}><td><button className="client-name-link" onClick={(event)=>{event.stopPropagation();open()}}>{String(c.client)}</button></td><td>{brl(Number(c.total_purchased))}</td><td>{brl(Number(c.paid))}</td><td>{brl(Number(c.pending))}</td><td>{integer(Number(c.item_count))}</td><td>{brl(Number(c.average_ticket))}</td><td>{String(c.top_perfume??'—')}</td><td>{Number(c.total_ml).toLocaleString('pt-BR')} ml</td><td>{integer(Number(c.pending_deliveries))}</td><td><span className="badge pending">{String(c.relationship_status)}</span></td><td>{c.first_purchase?shortDate(String(c.first_purchase)):'—'}</td><td>{c.last_purchase?shortDate(String(c.last_purchase)):'—'}</td><td><button onClick={(event)=>{event.stopPropagation();open()}}>Ver cliente</button></td></tr>})}</tbody></table></div>
    </div>}
  </div>
}

function ClientDetailsPage({clientId}:{clientId:string}) {
  const [data,setData]=useState<Awaited<ReturnType<typeof fetchClient360>>|null>(null)
  const [selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),[editing,setEditing]=useState(false)
  const [historySearch,setHistorySearch]=useState(''),[historyPayment,setHistoryPayment]=useState(''),[historyType,setHistoryType]=useState(''),[historyShipping,setHistoryShipping]=useState(''),[historyStart,setHistoryStart]=useState(''),[historyEnd,setHistoryEnd]=useState('')
  const [purchase,setPurchase]=useState<Record<string,unknown>|null>(null)
  useEffect(()=>{fetchClient360(clientId).then(setData).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o cliente.'))},[clientId])
  if(error)return <div className="page"><div className="notice"><AlertTriangle/><span>{error}</span></div></div>
  if(!data)return <div className="page"><div className="empty card"><h3>Carregando Cliente 360°…</h3></div></div>
  const {client}=data.profile,commercial=data.profile.commercial,waiting=data.profile.waiting
  const visibleHistory=data.history.filter((sale)=>
    (!historySearch||String(sale.perfume_name_raw??'').toLowerCase().includes(historySearch.toLowerCase()))&&
    (!historyPayment||sale.payment_status===historyPayment)&&(!historyType||sale.sale_type===historyType)&&
    (!historyShipping||(historyShipping==='shipped'?Boolean(sale.shipped_at):!sale.shipped_at))&&
    (!historyStart||String(sale.sale_date??'')>=historyStart)&&(!historyEnd||String(sale.sale_date??'')<=historyEnd))
  const editInitial={name:client.name,phone:client.phone??'',whatsappPhone:client.whatsapp_phone??'',email:client.email??'',instagram:client.instagram??'',cpf:client.cpf??'',cnpj:client.cnpj??'',birthDate:client.birth_date??'',postalCode:client.postal_code??'',address:client.address_line??'',addressNumber:client.address_number??'',complement:client.complement??'',district:client.district??'',city:client.city??'',state:client.state??'',notes:client.notes??'',status:client.status}
  const prepare=async()=>{if(!selected.length)return;setPreparing(true);setError('');try{const shipmentId=await createDraftShipment(clientId,selected);setSelected([]);const refreshed=await fetchClient360(clientId);setData(refreshed);alert(`Shipment preparado: ${shipmentId.slice(0,8)}`)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível preparar o envio.')}finally{setPreparing(false)}}
  return <div className="page client-360">
    {purchase&&<div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={()=>setPurchase(null)}/><div className="modal-panel"><div className="modal-title"><div><span>DETALHES DA COMPRA</span><h2>{String(purchase.perfume_name_raw??'Venda')}</h2></div><button onClick={()=>setPurchase(null)}><X/></button></div><div className="client-panel"><dl><dt>Data</dt><dd>{purchase.sale_date?shortDate(String(purchase.sale_date)):'—'}</dd><dt>Valor</dt><dd>{brl(Number(purchase.amount))}</dd><dt>Pagamento</dt><dd>{statusLabel[String(purchase.payment_status)]}</dd><dt>Prazo</dt><dd>{purchase.shipping_deadline_date?shortDate(String(purchase.shipping_deadline_date)):String(purchase.shipping_deadline_raw??'—')}</dd><dt>Envio</dt><dd>{purchase.shipped_at?shortDate(String(purchase.shipped_at)):'—'}</dd><dt>Observação</dt><dd>{String(purchase.notes??'—')}</dd></dl></div></div></div>}
    {editing&&<ClientModal clientId={clientId} initial={editInitial} close={()=>setEditing(false)} onSaved={()=>fetchClient360(clientId).then(setData)}/>}
    <button className="back-link" onClick={()=>{history.pushState({},'','/clientes');dispatchEvent(new PopStateEvent('popstate'))}}>← Voltar para clientes</button>
    <div className="page-lead"><div><span className="eyebrow">CLIENTE 360°</span><h2>{client.name}</h2><p>{client.phone||'Sem telefone'} · {client.email||'Sem e-mail'}</p></div><div className="page-actions"><button onClick={()=>setEditing(true)}>Editar dados</button><span className="badge paid">{client.status}</span></div></div>
    <section className="metrics"><Metric label="Total comprado" value={brl(Number(commercial.total_purchased))} detail={`${integer(Number(commercial.purchases))} compras`} icon={ShoppingBag}/><Metric label="Valor pago" value={brl(Number(commercial.paid))} detail={`Ticket médio ${brl(Number(commercial.average_ticket))}`} icon={Check}/><Metric label="Aguardando pagamento" value={brl(Number(commercial.pending))} detail={`${Number(commercial.total_ml).toLocaleString('pt-BR')} ML comprados`} icon={Clock3}/><Metric label="Crédito" value={brl(Number(commercial.credit))} detail="Crédito registrado nas vendas" icon={FileText}/><Metric label="Aguardando envio" value={`${Number(waiting.waiting_ml).toLocaleString('pt-BR')} ML`} detail={`${integer(Number(waiting.waiting_products))} allocations reservadas`} icon={Boxes}/></section>
    <section className="client-grid"><article className="card client-panel"><h3>Dados cadastrais</h3><dl><dt>Nome</dt><dd>{client.name}</dd><dt>Telefone</dt><dd>{client.phone||'—'}</dd><dt>WhatsApp</dt><dd>{client.whatsapp_phone||'—'}</dd><dt>E-mail</dt><dd>{client.email||'—'}</dd><dt>CPF</dt><dd>{client.cpf||'—'}</dd><dt>Instagram</dt><dd>{client.instagram||'—'}</dd><dt>Data de nascimento</dt><dd>{client.birth_date?shortDate(client.birth_date):'—'}</dd><dt>CEP</dt><dd>{client.postal_code||'—'}</dd><dt>Endereço</dt><dd>{client.address_line||'—'}</dd><dt>Número</dt><dd>{client.address_number||'—'}</dd><dt>Complemento</dt><dd>{client.complement||'—'}</dd><dt>Bairro</dt><dd>{client.district||'—'}</dd><dt>Cidade</dt><dd>{client.city||'—'}</dd><dt>UF</dt><dd>{client.state||'—'}</dd><dt>Observações</dt><dd>{client.notes||'—'}</dd></dl></article>
      <article className="card client-panel"><h3>Resumo comercial</h3><dl><dt>Total comprado</dt><dd>{brl(Number(commercial.total_purchased))}</dd><dt>Quantidade de compras</dt><dd>{integer(Number(commercial.purchases))}</dd><dt>Ticket médio</dt><dd>{brl(Number(commercial.average_ticket))}</dd><dt>Total pago</dt><dd>{brl(Number(commercial.paid))}</dd><dt>Total pendente</dt><dd>{brl(Number(commercial.pending))}</dd><dt>Crédito</dt><dd>{brl(Number(commercial.credit))}</dd><dt>Total ML</dt><dd>{Number(commercial.total_ml).toLocaleString('pt-BR')} ML</dd><dt>Primeira compra</dt><dd>{commercial.first_purchase?shortDate(commercial.first_purchase):'—'}</dd><dt>Última compra</dt><dd>{commercial.last_purchase?shortDate(commercial.last_purchase):'—'}</dd><dt>Perfume mais comprado</dt><dd>{commercial.top_perfume||'—'}</dd></dl></article></section>
    {error&&<div className="notice"><AlertTriangle/><span>{error}</span></div>}
    <div className="card clients-table"><div className="clients-caption"><div><strong>Produtos aguardando envio</strong><span>Selecione várias compras para um único Shipment</span></div><button className="primary" disabled={!selected.length||preparing} onClick={prepare}>{preparing?'Preparando…':`Preparar envio (${selected.length})`}</button></div><div className="table-wrap"><table><thead><tr><th></th><th>Venda</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Origem</th><th>Guardado há</th></tr></thead><tbody>{data.waiting.map((item)=><tr key={item.allocation_id}><td><input type="checkbox" checked={selected.includes(item.allocation_id)} onChange={(event)=>setSelected((current)=>event.target.checked?[...current,item.allocation_id]:current.filter((id)=>id!==item.allocation_id))}/></td><td>{shortDate(item.sale_date)}</td><td><strong>{item.perfume}</strong></td><td>{item.sale_type}</td><td>{Number(item.quantity_ml).toLocaleString('pt-BR')} ML</td><td>{brl(Number(item.amount))}</td><td><span className={`badge ${item.stock_managed?'paid':'pending'}`}>{item.stock_managed?'ESTOQUE OPERACIONAL':'CONFERIDO MANUALMENTE'}</span>{item.storage_location&&<small>{item.storage_location}</small>}</td><td>{item.days_waiting} dias</td></tr>)}</tbody></table>{data.waiting.length===0&&<div className="inline-empty">Nenhum produto alocado aguardando envio.</div>}</div></div>
    <div className="card clients-table"><div className="clients-caption"><strong>Histórico completo de compras</strong><span>{integer(visibleHistory.length)} de {integer(data.history.length)} registros</span></div><div className="toolbar history-toolbar"><div className="search"><Search/><input value={historySearch} onChange={(event)=>setHistorySearch(event.target.value)} placeholder="Filtrar perfume…"/></div><input type="date" aria-label="Início" value={historyStart} onChange={(event)=>setHistoryStart(event.target.value)}/><input type="date" aria-label="Fim" value={historyEnd} onChange={(event)=>setHistoryEnd(event.target.value)}/><select value={historyPayment} onChange={(event)=>setHistoryPayment(event.target.value)}><option value="">Todos os pagamentos</option><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Revisão</option></select><select value={historyType} onChange={(event)=>setHistoryType(event.target.value)}><option value="">APC e SPLIT</option><option>APC</option><option>SPLIT</option></select><select value={historyShipping} onChange={(event)=>setHistoryShipping(event.target.value)}><option value="">Enviado e guardado</option><option value="shipped">Enviado</option><option value="waiting">Não enviado</option></select></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Forma</th><th>Pago em</th><th>Origem</th><th>Envio</th><th>Rastreio</th></tr></thead><tbody>{visibleHistory.map((sale)=>{const shipment=(sale.shipment_items as {shipments?:{status?:string;tracking_code?:string}}[]|undefined)?.[0]?.shipments;return <tr key={String(sale.id)}><td>{sale.sale_date?shortDate(String(sale.sale_date)):'—'}</td><td><strong>{String(sale.perfume_name_raw??'—')}</strong></td><td>{String(sale.sale_type??'—')}</td><td>{sale.volume_ml===null?'—':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ML`}</td><td>{brl(Number(sale.amount))}</td><td><span className={`badge ${sale.payment_status}`}>{statusLabel[String(sale.payment_status)]}</span></td><td>{String(sale.payment_method??'—')}</td><td>{sale.paid_at?shortDate(String(sale.paid_at)):'—'}</td><td>{sale.source==='spreadsheet'?'Planilha':'Manual'}</td><td>{shipment?.status??(sale.shipped_at?shortDate(String(sale.shipped_at)):'Sem registro')}</td><td>{shipment?.tracking_code??'—'}</td></tr>})}</tbody></table></div></div>
    <div className="card clients-table"><div className="clients-caption"><strong>Logística das compras</strong><span>Histórico legado; não representa allocations operacionais.</span></div><div className="table-wrap"><table><thead><tr><th>Compra</th><th>Perfume</th><th>Prazo previsto</th><th>Data de envio</th><th>Status histórico</th><th>Dias até envio</th><th>Prazo</th><th>Observação</th><th>Ação</th></tr></thead><tbody>{visibleHistory.map((sale)=>{const days=sale.sale_date&&sale.shipped_at?Math.round((new Date(String(sale.shipped_at)).valueOf()-new Date(String(sale.sale_date)).valueOf())/86400000):null,deadline=sale.shipping_deadline_date?String(sale.shipping_deadline_date):null;return <tr key={`log-${String(sale.id)}`}><td>{sale.sale_date?shortDate(String(sale.sale_date)):'—'}</td><td><strong>{String(sale.perfume_name_raw??'—')}</strong></td><td>{deadline?shortDate(deadline):String(sale.shipping_deadline_raw??'—')}</td><td>{sale.shipped_at?shortDate(String(sale.shipped_at)):'—'}</td><td>{String(sale.shipping_operational_status??(sale.shipped_at?'Enviado':'Sem status'))}</td><td>{days===null?'—':`${days} dias`}</td><td>{deadline&&sale.shipped_at?(String(sale.shipped_at)<=deadline?'Dentro do prazo':'Atrasado'):'—'}</td><td>{String(sale.notes??'—')}</td><td><button onClick={()=>setPurchase(sale as Record<string,unknown>)}>Ver venda</button></td></tr>})}</tbody></table></div></div>
    <div className="card clients-table"><div className="clients-caption"><strong>Shipments da nova operação</strong><span>Várias compras podem compartilhar uma única etiqueta.</span></div><div className="table-wrap"><table><thead><tr><th>Criado</th><th>Compras juntas</th><th>Status</th><th>Transportadora</th><th>Serviço</th><th>Frete</th><th>Rastreio</th><th>Postado</th><th>Entregue</th></tr></thead><tbody>{data.shipments.map((shipment)=>{const items=shipment.shipment_items as unknown[]|undefined;return <tr key={String(shipment.id)}><td>{new Date(String(shipment.created_at)).toLocaleDateString('pt-BR')}</td><td>{integer(items?.length??0)}</td><td>{String(shipment.status)}</td><td>{String(shipment.carrier??'—')}</td><td>{String(shipment.service??'—')}</td><td>{shipment.shipping_price?brl(Number(shipment.shipping_price)):'—'}</td><td>{String(shipment.tracking_code??'—')}</td><td>{shipment.posted_at?new Date(String(shipment.posted_at)).toLocaleDateString('pt-BR'):'—'}</td><td>{shipment.delivered_at?new Date(String(shipment.delivered_at)).toLocaleDateString('pt-BR'):'—'}</td></tr>})}</tbody></table>{data.shipments.length===0&&<div className="inline-empty">Nenhum Shipment operacional para esta cliente.</div>}</div></div>
  </div>
}

const exportCsv=(name:string,rows:Record<string,unknown>[])=>{const keys=Object.keys(rows[0]??{});const escape=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;const csv=[keys.map(escape).join(';'),...rows.map((row)=>keys.map((key)=>escape(row[key])).join(';'))].join('\n');const url=URL.createObjectURL(new Blob([`\uFEFF${csv}`],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url)}

function SalesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [modal,setModal]=useState(false)
  const [sales,setSales]=useState<CommercialSale[]>([])
  const [count,setCount]=useState(0)
  const [page,setPage]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [filters,setFilters]=useState<SaleFilters>({period,sort:'sale_date_desc'})
  const [showMoreFilters,setShowMoreFilters]=useState(false)
  const details:CommercialSale|null=null
  const setDetails=(sale:CommercialSale|null)=>{if(sale){history.pushState({},'',`/vendas/${sale.id}`);dispatchEvent(new PopStateEvent('popstate'))}}
  const setFilter=(key:keyof SaleFilters,value:string)=>{setPage(0);setFilters((current)=>({...current,[key]:value||undefined}))}
  const activeFilterCount=Object.entries(filters).filter(([key,value])=>key!=='period'&&key!=='sort'&&value!==undefined&&value!=='').length
  const clearFilters=()=>{setPage(0);setFilters({period,sort:'sale_date_desc'})}
  useEffect(()=>{fetchSalesPage({...filters,period},page,50).then((result)=>{setSales(result.rows);setCount(result.count)}).catch(()=>setError('Não foi possível consultar as vendas.')).finally(()=>setLoading(false))},[filters,page,period])
  const total=sales.reduce((sum,sale)=>sum+Number(sale.amount),0)
  return <div className="page">{modal&&<SaleModal close={()=>setModal(false)}/>} {details&&<SaleDetails sale={details} close={()=>setDetails(null)}/>}<div className="page-lead"><div><h2>Vendas</h2><p>Consulta, edição e exportação dos registros reais.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button onClick={()=>exportCsv('vendas-ruah.csv',sales as unknown as Record<string,unknown>[])}><Download size={17}/> Exportar CSV</button><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> Nova venda</button></div></div>
    <div className="sales-filter-panel card">
      <div className="filter-primary"><div className="search"><Search size={18}/><input value={filters.search??''} onChange={(event)=>setFilter('search',event.target.value)} placeholder="Buscar cliente, perfume ou observação…"/></div>
        <select value={filters.status??''} onChange={(event)=>setFilter('status',event.target.value)}><option value="">Todos os pagamentos</option><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Revisão</option></select>
        <select value={filters.sort??''} onChange={(event)=>setFilter('sort',event.target.value)}><option value="sale_date_desc">Mais recentes</option><option value="sale_date_asc">Mais antigas</option><option value="amount_desc">Maior valor</option><option value="client_name_raw_asc">Cliente A–Z</option><option value="perfume_name_raw_asc">Perfume A–Z</option></select>
        <button className={showMoreFilters?'filter-toggle active':'filter-toggle'} onClick={()=>setShowMoreFilters(!showMoreFilters)}><SlidersHorizontal/> Mais filtros {activeFilterCount>0&&<i>{activeFilterCount}</i>}</button>
        {activeFilterCount>0&&<button className="filter-clear" onClick={clearFilters}><RotateCcw/> Limpar</button>}
      </div>
      {showMoreFilters&&<div className="filter-secondary">
        <label><span>Cliente</span><input value={filters.client??''} onChange={(event)=>setFilter('client',event.target.value)} placeholder="Nome do cliente"/></label>
        <label><span>Perfume</span><input value={filters.perfume??''} onChange={(event)=>setFilter('perfume',event.target.value)} placeholder="Nome do perfume"/></label>
        <label><span>Tipo</span><select value={filters.type??''} onChange={(event)=>setFilter('type',event.target.value)}><option value="">Todos</option><option>APC</option><option>SPLIT</option></select></label>
        <label><span>Volume</span><input inputMode="decimal" value={filters.volumeMl??''} onChange={(event)=>setFilters((current)=>({...current,volumeMl:event.target.value?Number(event.target.value):undefined}))} placeholder="ML"/></label>
        <label><span>Forma de pagamento</span><select value={filters.method??''} onChange={(event)=>setFilter('method',event.target.value)}><option value="">Todas</option><option>PIX</option><option>CARTÃO</option><option>DEPÓSITO</option></select></label>
        <label><span>Origem</span><select value={filters.origin??''} onChange={(event)=>setFilter('origin',event.target.value)}><option value="">Todas</option><option value="spreadsheet">Importação</option><option value="manual">Manual</option></select></label>
        <label><span>Valor mínimo</span><input inputMode="decimal" value={filters.minValue??''} onChange={(event)=>setFilters((current)=>({...current,minValue:event.target.value?Number(event.target.value):undefined}))} placeholder="R$ 0,00"/></label>
        <label><span>Valor máximo</span><input inputMode="decimal" value={filters.maxValue??''} onChange={(event)=>setFilters((current)=>({...current,maxValue:event.target.value?Number(event.target.value):undefined}))} placeholder="Sem limite"/></label>
      </div>}
    </div>
    {loading?<div className="empty card"><h3>Carregando vendas…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(count)} vendas filtradas</strong><span>{brl(total)} nesta página</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Forma</th><th>Data pagmt.</th><th>Prazo</th><th>Data envio</th><th>Entrega</th><th>Origem</th><th>Ações</th></tr></thead>
      <tbody>{sales.map((sale)=><tr key={sale.id}><td>{sale.sale_date?shortDate(sale.sale_date):'—'}</td><td><strong>{sale.clients?.name??sale.original_client??'—'}</strong></td><td>{sale.perfume_name_raw??'—'}</td><td>{sale.sale_type??'—'}</td><td>{sale.volume_ml===null?'Revisar':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ml`}</td><td>{brl(Number(sale.amount))}</td><td><span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]}</span></td><td>{sale.payment_method??'—'}</td><td>{sale.paid_at?shortDate(sale.paid_at):'—'}</td><td>{sale.shipping_deadline_raw||'—'}</td><td>{sale.shipped_at?shortDate(sale.shipped_at):'—'}</td><td>{deliveryLabel(sale)}</td><td>{sale.source==='spreadsheet'?'Importação':'Manual'}</td><td><button onClick={()=>setDetails(sale)}>Ver detalhes</button></td></tr>)}</tbody></table></div>
      <div className="table-foot"><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.max(1,Math.ceil(count/50))}</span><button disabled={(page+1)*50>=count} onClick={()=>setPage(page+1)}>Próxima</button></div>
    </div>}
  </div>
}

function SaleDetails({sale,close}:{sale:CommercialSale;close:()=>void}){const shipment=sale.shipment_items?.[0]?.shipments,days=sale.sale_date&&sale.shipped_at?Math.round((new Date(sale.shipped_at).valueOf()-new Date(sale.sale_date).valueOf())/86400000):null;return <div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={close}/><div className="modal-panel"><div className="modal-title"><div><span>VENDA E LOGÍSTICA</span><h2>{sale.clients?.name??sale.original_client??'Venda'}</h2></div><button onClick={close}><X/></button></div><div className="client-grid"><article className="card client-panel"><h3>Compra</h3><dl><dt>Perfume</dt><dd>{sale.perfume_name_raw??'—'}</dd><dt>Data</dt><dd>{sale.sale_date?shortDate(sale.sale_date):'—'}</dd><dt>Valor</dt><dd>{brl(Number(sale.amount))}</dd><dt>Pagamento</dt><dd>{statusLabel[sale.payment_status]}</dd></dl></article><article className="card client-panel"><h3>Logística</h3><dl><dt>Fonte</dt><dd>{shipment?'Shipment operacional':'Histórico legado'}</dd><dt>Status</dt><dd>{shipment?.status??deliveryLabel(sale)}</dd><dt>Prazo previsto</dt><dd>{sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'}</dd><dt>Data efetiva</dt><dd>{sale.shipped_at?shortDate(sale.shipped_at):shipment?.posted_at?shortDate(shipment.posted_at):'—'}</dd><dt>Tempo até envio</dt><dd>{days===null?'—':`${days} dias`}</dd><dt>Transportadora</dt><dd>{shipment?.carrier??'—'}</dd><dt>Rastreio</dt><dd>{shipment?.tracking_code??'—'}</dd><dt>Entrega</dt><dd>{shipment?.delivered_at?shortDate(shipment.delivered_at):'—'}</dd></dl></article></div></div></div>}

function SaleDetailsPage({saleId}:{saleId:string}){
  const [sale,setSale]=useState<CommercialSale|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),[confirming,setConfirming]=useState(false),[confirmed,setConfirmed]=useState(false),[location,setLocation]=useState(''),[saving,setSaving]=useState(false)
  const [verificationNote,setVerificationNote]=useState('Produto conferido manualmente para envio.')
  const reload=()=>fetchSale360(saleId).then(setSale).catch(reason=>setError(reason instanceof Error?reason.message:'Venda não encontrada.'))
  useEffect(()=>{fetchSale360(saleId).then(setSale).catch(reason=>setError(reason instanceof Error?reason.message:'Venda não encontrada.'))},[saleId])
  if(error)return <div className="page"><div className="notice"><AlertTriangle/><span>{error}</span></div></div>
  if(!sale)return <div className="page"><div className="empty card"><h3>Carregando Venda 360…</h3></div></div>
  const allocation=sale.inventory_allocations?.find(item=>['reserved','shipping','shipped'].includes(item.status)),shipment=sale.shipment_items?.[0]?.shipments
  const prepare=async()=>{if(!sale.client_id||!allocation)return;setPreparing(true);setError('');try{const id=await createDraftShipment(sale.client_id,[allocation.id]);history.pushState({},'',`/entregas/${id}`);dispatchEvent(new PopStateEvent('popstate'))}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível preparar o envio.')}finally{setPreparing(false)}}
  const confirmCustody=async()=>{if(!confirmed)return;setSaving(true);setError('');try{await confirmLegacyProductCustody(sale.id,location,verificationNote);setConfirming(false);setConfirmed(false);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível confirmar o produto.')}finally{setSaving(false)}}
  const release=async()=>{if(!allocation)return;setSaving(true);try{await releaseLegacyProductCustody(allocation.id);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível remover a confirmação.')}finally{setSaving(false)}}
  const canConfirm=!allocation&&!shipment&&!sale.shipped_at&&Boolean(sale.client_id&&sale.perfume_id&&sale.volume_ml&&sale.volume_ml>0)
  return <div className="page sale-360">{confirming&&<div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={()=>setConfirming(false)}/><div className="modal-panel"><div className="modal-title"><div><span>CONFIRMAÇÃO HUMANA</span><h2>Confirmar produto em custódia</h2></div><button onClick={()=>setConfirming(false)}><X/></button></div><div className="record-form"><div className="client-panel"><dl><dt>Cliente</dt><dd>{sale.clients?.name||sale.original_client||'—'}</dd><dt>Perfume</dt><dd>{sale.perfume_name_raw||'—'}</dd><dt>Tipo / ML</dt><dd>{sale.sale_type||'—'} · {sale.volume_ml} ml</dd><dt>Venda</dt><dd>{brl(Number(sale.amount))}</dd><dt>Data</dt><dd>{sale.sale_date?shortDate(sale.sale_date):'—'}</dd></dl></div><strong>Você conferiu fisicamente este produto?</strong><label className="selection-row"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Confirmei que este produto está fisicamente em posse da RUAH e pertence a este cliente.</span></label><label className="field"><span>Localização / caixa</span><input value={location} onChange={event=>setLocation(event.target.value)} placeholder="Ex.: Caixa Érica, Prateleira 2"/></label><label className="field"><span>Observação</span><textarea value={verificationNote} onChange={event=>setVerificationNote(event.target.value)}/></label><div className="notice"><span>Esta confirmação não altera o estoque operacional.</span></div><div className="form-actions"><button onClick={()=>setConfirming(false)}>Cancelar</button><button className="primary" disabled={!confirmed||saving} onClick={confirmCustody}>{saving?'Confirmando…':'CONFIRMAR PRODUTO EM CUSTÓDIA'}</button></div></div></div></div>}<button className="back-link" onClick={()=>history.back()}>← Voltar para vendas</button><div className="page-lead"><div><span className="eyebrow">VENDA 360</span><h2>{sale.clients?.name??sale.original_client??'Venda'}</h2><p>{sale.id}</p></div><div className="page-actions">{canConfirm&&<button className="primary" onClick={()=>setConfirming(true)}>CONFIRMAR PRODUTO EM CUSTÓDIA</button>}{allocation?.status==='reserved'&&<button className="primary" disabled={preparing} onClick={prepare}>{preparing?'Preparando…':'PREPARAR ENVIO'}</button>}{shipment&&<a className="button-link" href={`/entregas/${shipment.id}`}>Abrir Shipment 360</a>}</div></div><section className="metrics"><Metric label="Valor" value={brl(Number(sale.amount))} detail={sale.sale_date?shortDate(sale.sale_date):'Sem data'} icon={ShoppingBag}/><Metric label="Pagamento" value={statusLabel[sale.payment_status]||sale.payment_status} detail={sale.paid_at?shortDate(sale.paid_at):'Sem baixa'} icon={Check}/><Metric label="Crédito" value={brl(Number(sale.credit_reference_amount||0))} detail={sale.payment_method||'Forma não informada'} icon={FileText}/><Metric label="Estoque" value={allocation?`${Number(allocation.quantity_ml).toLocaleString('pt-BR')} ml`:'Nenhuma operação'} detail={allocation?.stock_managed?'Estoque operacional':allocation?'Conferido manualmente':'Nenhuma operação de estoque vinculada'} icon={Boxes}/></section><section className="client-grid"><article className="card client-panel"><h3>Cliente</h3><dl><dt>Nome</dt><dd>{sale.clients?.name||'—'}</dd><dt>Telefone</dt><dd>{sale.clients?.phone||sale.clients?.whatsapp_phone||'—'}</dd><dt>E-mail</dt><dd>{sale.clients?.email||'—'}</dd><dt>Documento</dt><dd>{sale.clients?.cpf||sale.clients?.cnpj||'—'}</dd><dt>Endereço</dt><dd>{[sale.clients?.address_line,sale.clients?.address_number,sale.clients?.city,sale.clients?.state].filter(Boolean).join(', ')||'—'}</dd></dl></article><article className="card client-panel"><h3>Comercial e financeiro</h3><dl><dt>Perfume</dt><dd>{sale.perfume_name_raw||'—'}</dd><dt>Tipo / volume</dt><dd>{sale.sale_type||'—'} · {sale.volume_ml??'—'} ml</dd><dt>Origem</dt><dd>{sale.source==='spreadsheet'?'Importação':'Manual'}</dd><dt>Observações</dt><dd>{sale.notes||'—'}</dd><dt>Prazo histórico</dt><dd>{sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'}</dd><dt>Envio histórico</dt><dd>{sale.shipped_at?shortDate(sale.shipped_at):'—'}</dd></dl></article><article className="card client-panel"><h3>Logística</h3><dl><dt>Allocation</dt><dd>{allocation?.status||'Nenhuma operação de estoque vinculada'}</dd><dt>Origem</dt><dd>{allocation?.stock_managed?'ESTOQUE OPERACIONAL':allocation?'CONFERIDO MANUALMENTE':'—'}</dd><dt>Confirmado em</dt><dd>{allocation?.verified_at?shortDate(allocation.verified_at):'—'}</dd><dt>Localização</dt><dd>{allocation?.storage_location||'—'}</dd><dt>Shipment</dt><dd>{shipment?.id||'Ainda não preparado'}</dd><dt>Status</dt><dd>{shipment?.status||sale.shipping_operational_status||'—'}</dd><dt>SuperFrete</dt><dd>{shipment?.carrier?`${shipment.carrier} · ${shipment.service||''}`:'—'}</dd><dt>Rastreio</dt><dd>{shipment?.tracking_code||'—'}</dd></dl>{allocation?.allocation_source==='legacy_manual_verified'&&allocation.status==='reserved'&&!allocation.shipment_id&&<button disabled={saving} onClick={release}>REMOVER CONFIRMAÇÃO</button>}</article></section></div>
}

const todayIso=()=>format(new Date(),'yyyy-MM-dd')
function deliveryState(sale:CommercialSale) {
  if(sale.shipped_at&&sale.shipping_deadline_date)return sale.shipped_at<=sale.shipping_deadline_date?'shipped_on_time':'shipped_late'
  if(sale.shipped_at)return 'shipped'
  if(sale.shipping_deadline_date)return sale.shipping_deadline_date<todayIso()?'overdue':'awaiting_shipment'
  return 'no_deadline'
}
const deliveryLabels:Record<string,string>={awaiting_shipment:'Aguardando envio',overdue:'Envio atrasado',shipped_on_time:'Enviado no prazo',shipped_late:'Enviado com atraso',shipped:'Enviado',no_deadline:'Sem prazo'}
const deliveryLabel=(sale:CommercialSale)=>deliveryLabels[deliveryState(sale)]

function DeliveriesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [rows,setRows]=useState<CommercialSale[]>([]),[filter,setFilter]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [newShipment,setNewShipment]=useState(false),[historical,setHistorical]=useState<CommercialSale|null>(null),[historicalDate,setHistoricalDate]=useState(todayIso())
  const [summary,setSummary]=useState<LogisticsSummary|null>(null)
  const reload=()=>{Promise.all([fetchDeliveryRows(period),fetchLogisticsSummary(period)]).then(([sales,metrics])=>{setRows(sales);setSummary(metrics)}).catch(()=>setError('Não foi possível consultar as entregas.')).finally(()=>setLoading(false))}
  useEffect(reload,[period])
  const counts=rows.reduce((acc,row)=>{const key=deliveryState(row);acc[key]=(acc[key]??0)+1;return acc},{} as Record<string,number>)
  const visible=rows.filter((row)=>(!filter||deliveryState(row)===filter)&&(!search||`${row.original_client} ${row.perfume_name_raw}`.toLowerCase().includes(search.toLowerCase())))
  const register=async(row:CommercialSale,value:string|null)=>{try{await updateShipment(row.id,value);setHistorical(null);reload()}catch(err){setError(err instanceof Error?err.message:'Falha ao atualizar envio.')}}
  return <div className="page">{newShipment&&<NewShipmentModal close={()=>setNewShipment(false)}/>} {historical&&<div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={()=>setHistorical(null)}/><div className="modal-panel"><div className="modal-title"><div><span>LOGÍSTICA HISTÓRICA</span><h2>Registrar envio histórico</h2></div><button onClick={()=>setHistorical(null)}><X/></button></div><div className="record-form"><p>Atualiza somente a data histórica da venda; não cria allocation nem Shipment.</p><label className="field"><span>Data do envio</span><input type="date" value={historicalDate} onChange={event=>setHistoricalDate(event.target.value)}/></label><div className="form-actions">{historical.shipped_at&&<button onClick={()=>register(historical,null)}>Remover data</button>}<button onClick={()=>setHistorical(null)}>Cancelar</button><button className="primary" disabled={!historicalDate} onClick={()=>register(historical,historicalDate)}>Salvar envio histórico</button></div></div></div></div>}<div className="page-lead"><div><h2>Entregas</h2><p>Shipments operacionais e registros históricos claramente separados.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button className="primary" onClick={()=>setNewShipment(true)}><Plus/> Novo envio</button></div></div>
    <OperationalShipments/>
    {summary&&<section className="coverage card"><div><span>Envios identificados</span><strong>{integer(summary.identified_shipments)}</strong></div><div><span>Enviados no período</span><strong>{integer(summary.shipped_in_period)}</strong></div><div><span>Média até envio</span><strong>{summary.average_days_to_ship==null?'—':`${summary.average_days_to_ship} dias`}</strong></div><div><span>Backlog operacional</span><strong>{integer(summary.operational_backlog)}</strong></div><div><span>Dentro do prazo real</span><strong>{integer(summary.historical_on_time)}</strong></div><div><span>Atrasados com prazo real</span><strong>{integer(summary.historical_late)}</strong></div></section>}
    <section className="metrics">{[['awaiting_shipment','Aguardando envio'],['overdue','Envio atrasado'],['shipped_on_time','Enviados no prazo'],['shipped_late','Enviados com atraso'],['shipped','Enviados'],['no_deadline','Sem prazo']].map(([key,label])=><Metric key={key} label={label} value={integer(counts[key]??0)} detail={period.label} icon={Truck}/>)}</section>
    <div className="toolbar card"><div className="search"><Search size={18}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Cliente ou perfume…"/></div><select value={filter} onChange={(event)=>setFilter(event.target.value)}><option value="">Todos os status</option>{Object.entries(deliveryLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
    {loading?<div className="empty card"><h3>Carregando entregas…</h3></div>:error?<div className="notice"><AlertTriangle/><span>{error}</span></div>:<div className="card clients-table"><div className="clients-caption"><strong>{integer(visible.length)} registros históricos</strong><span className="live-dot">SUPABASE</span></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Venda</th><th>Prazo</th><th>Envio</th><th>Status</th><th>Valor</th><th>Observação</th><th>Ações</th></tr></thead><tbody>{visible.slice(0,500).map((row)=><tr key={row.id}><td><strong>{row.clients?.name??row.original_client}</strong></td><td>{row.perfume_name_raw}</td><td>{row.sale_type}</td><td>{row.volume_ml??'—'}</td><td>{row.sale_date?shortDate(row.sale_date):'—'}</td><td>{row.shipping_deadline_date?shortDate(row.shipping_deadline_date):row.shipping_deadline_raw||'—'}</td><td>{row.shipped_at?shortDate(row.shipped_at):'—'}</td><td><span className={`badge ${deliveryState(row)==='overdue'?'cancelled':'pending'}`}>{deliveryLabel(row)}</span></td><td>{brl(Number(row.amount))}</td><td>{row.notes??'—'}</td><td><button onClick={()=>{setHistorical(row);setHistoricalDate(row.shipped_at?.slice(0,10)||todayIso())}}>{row.shipped_at?'Editar envio histórico':'Registrar envio histórico'}</button></td></tr>)}</tbody></table></div></div>}
  </div>
}

function previousPeriod(period:PeriodValue):PeriodValue {
  const start=parseISO(period.start),end=parseISO(period.end),days=Math.max(1,Math.round((end.getTime()-start.getTime())/86400000)+1)
  const previousEnd=subDays(start,1),previousStart=subDays(previousEnd,days-1)
  return {start:format(previousStart,'yyyy-MM-dd'),end:format(previousEnd,'yyyy-MM-dd'),label:'Período anterior'}
}
function ReportsPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [current,setCurrent]=useState<PeriodSummary|null>(null),[previous,setPrevious]=useState<PeriodSummary|null>(null)
  useEffect(()=>{Promise.all([fetchPeriodSummary(period),fetchPeriodSummary(previousPeriod(period))]).then(([a,b])=>{setCurrent(a);setPrevious(b)})},[period])
  const variation=(now:number,before:number)=>before?`${(((now-before)/before)*100).toFixed(1).replace('.',',')}%`:'—'
  const rows=current?[{indicador:'Valor pago',atual:brl(Number(current.paid)),anterior:brl(Number(previous?.paid??0)),variacao:variation(Number(current.paid),Number(previous?.paid??0))},{indicador:'Vendas',atual:integer(current.sales),anterior:integer(previous?.sales??0),variacao:variation(current.sales,previous?.sales??0)},{indicador:'Ticket médio',atual:brl(Number(current.average_ticket)),anterior:brl(Number(previous?.average_ticket??0)),variacao:variation(Number(current.average_ticket),Number(previous?.average_ticket??0))},{indicador:'Clientes',atual:integer(current.buying_clients),anterior:integer(previous?.buying_clients??0),variacao:variation(current.buying_clients,previous?.buying_clients??0)}]:[]
  return <div className="page"><div className="page-lead"><div><h2>Relatórios</h2><p>Resumo financeiro e comparação matemática entre períodos.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button onClick={()=>exportCsv('relatorio-ruah.csv',rows)}><Download/> Exportar</button></div></div>
    {!current?<div className="empty card"><h3>Carregando relatório…</h3></div>:<><section className="metrics"><Metric label="Pagamentos" value={integer(current.paid_count)} detail={brl(Number(current.paid))} icon={Check}/><Metric label="Aguardando" value={integer(current.pending_count)} detail={brl(Number(current.pending))} icon={Clock3}/><Metric label="Canceladas" value={integer(current.cancelled_count)} detail={brl(Number(current.cancelled))} icon={X}/><Metric label="Em revisão" value={integer(current.review_count)} detail={brl(Number(current.review))} icon={AlertTriangle}/><Metric label="Ticket médio" value={brl(Number(current.average_ticket))} detail={`${integer(current.buying_clients)} clientes`} icon={TrendingUp}/><Metric label="Entregas pendentes" value={integer(current.deliveries_pending)} detail={`${integer(current.deliveries_overdue)} atrasadas`} icon={Truck}/></section><div className="card clients-table"><div className="clients-caption"><strong>Comparação com o período anterior</strong></div><table><thead><tr><th>Indicador</th><th>Atual</th><th>Anterior</th><th>Variação</th></tr></thead><tbody>{rows.map((row)=><tr key={row.indicador}><td>{row.indicador}</td><td>{row.atual}</td><td>{row.anterior}</td><td>{row.variacao}</td></tr>)}</tbody></table></div></>}
  </div>
}

function InventoryPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [summary,setSummary]=useState<InventorySummary|null>(null),[rows,setRows]=useState<InventoryRow[]>([])
  const [operational,setOperational]=useState<OperationalInventoryRow[]>([])
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showCreate,setShowCreate]=useState(false)
  const reload=()=>{setLoading(true);Promise.all([fetchInventory(period),fetchOperationalInventory()]).then(([result,balances])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))}
  useEffect(()=>{Promise.all([fetchInventory(period),fetchOperationalInventory()]).then(([result,balances])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))},[period])
  const adjust=async(row:InventoryRow,positive:boolean)=>{const raw=prompt(`${positive?'Entrada':'Ajuste negativo'} em ML para ${row.perfume}:`);if(!raw)return;const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return alert('Informe uma quantidade válida.');const reason=prompt('Motivo obrigatório:')?.trim();if(!reason)return;if(!positive&&!confirm(`Confirma retirar ${amount} ML de ${row.perfume}?`))return;try{await adjustInventory(row.item_id,positive?amount:-amount,reason);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível registrar o movimento.')}}
  return <div className="page">
    {showCreate&&<InventoryCreate close={()=>setShowCreate(false)} saved={()=>{setShowCreate(false);reload()}}/>}
    <div className="page-lead"><div><h2>Estoque</h2><p>Saldo em ML e movimentações integradas às novas vendas.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button className="primary" onClick={()=>setShowCreate(true)}><Plus/> Cadastrar perfume</button></div></div>
    {summary&&<section className="metrics"><Metric label="Estoque físico" value={`${operational.reduce((sum,row)=>sum+Number(row.physical_ml),0).toLocaleString('pt-BR')} ML`} detail={`${integer(summary.items)} perfumes`} icon={Boxes}/><Metric label="Reservado para clientes" value={`${operational.reduce((sum,row)=>sum+Number(row.reserved_ml)+Number(row.shipping_ml),0).toLocaleString('pt-BR')} ML`} detail="Pago e ainda guardado" icon={UserRound}/><Metric label="Disponível para venda" value={`${operational.reduce((sum,row)=>sum+Number(row.available_ml),0).toLocaleString('pt-BR')} ML`} detail={`${operational.filter((row)=>row.reconciliation_status==='review_required').length} para reconciliar`} icon={Check}/><Metric label="Consumo no período" value={`${Number(summary.consumed_ml).toLocaleString('pt-BR')} ML`} detail={`${integer(summary.movements)} movimentações`} icon={TrendingUp}/></section>}
    {error?<div className="notice"><AlertTriangle/><span>{error}</span></div>:loading?<div className="empty card"><h3>Carregando estoque…</h3></div>:rows.length===0?<div className="empty card"><Boxes/><h3>Estoque pronto para começar</h3><p>Cadastre o saldo físico inicial de um perfume.</p><button className="primary" onClick={()=>setShowCreate(true)}>Cadastrar primeiro perfume</button></div>:<div className="card clients-table"><div className="clients-caption"><strong>{integer(rows.length)} perfumes controlados</strong><button onClick={()=>exportCsv('estoque-ruah.csv',operational as unknown as Record<string,unknown>[])}><Download/> Exportar</button></div><div className="table-wrap"><table><thead><tr><th>Perfume</th><th>Físico</th><th>Reservado</th><th>Em preparação</th><th>Disponível</th><th>Limite mínimo</th><th>Reconciliação</th><th>Ações</th></tr></thead><tbody>{operational.map((balance)=><tr key={balance.item_id}><td><strong>{balance.perfume}</strong></td><td>{Number(balance.physical_ml).toLocaleString('pt-BR')} ML</td><td>{Number(balance.reserved_ml).toLocaleString('pt-BR')} ML</td><td>{Number(balance.shipping_ml).toLocaleString('pt-BR')} ML</td><td>{Number(balance.available_ml).toLocaleString('pt-BR')} ML</td><td>{Number(balance.minimum_ml).toLocaleString('pt-BR')} ML</td><td><span className={`badge ${balance.reconciliation_status==='reconciled'?'paid':'pending'}`}>{balance.reconciliation_status==='reconciled'?'Reconciliado':'Revisão necessária'}</span></td><td><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,true)}>Entrada</button><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,false)}>Ajustar</button></td></tr>)}</tbody></table></div></div>}
  </div>
}

function InventoryCreate({close,saved}:{close:()=>void;saved:()=>void}) {
  const [perfumes,setPerfumes]=useState<{id:string;full_name_raw:string}[]>([]),[perfumeId,setPerfumeId]=useState('')
  const [opening,setOpening]=useState(''),[minimum,setMinimum]=useState(''),[reference,setReference]=useState(format(new Date(),'yyyy-MM-dd')),[notes,setNotes]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  useEffect(()=>{inventoryPerfumes().then((data)=>setPerfumes(data))},[])
  const submit=async()=>{const openingMl=Number(opening.replace(',','.')),minimumMl=Number(minimum.replace(',','.'));if(!perfumeId||!Number.isFinite(openingMl)||openingMl<0||!Number.isFinite(minimumMl)||minimumMl<0||!reference)return setError('Preencha perfume, saldos e data corretamente.');setSaving(true);try{await createInventoryItem({perfumeId,openingMl,minimumMl,referenceDate:reference,notes});saved()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível cadastrar o estoque.')}finally{setSaving(false)}}
  return <div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={close}/><div className="modal-panel inventory-modal"><div className="modal-title"><div><span>CONTROLE DE ESTOQUE</span><h2>Cadastrar perfume</h2></div><button onClick={close}><X/></button></div><div className="record-form"><div className="form-grid"><label className="field wide"><span>Perfume existente</span><select value={perfumeId} onChange={(event)=>setPerfumeId(event.target.value)}><option value="">Selecione…</option>{perfumes.map((perfume)=><option key={perfume.id} value={perfume.id}>{perfume.full_name_raw}</option>)}</select></label><label className="field"><span>Saldo inicial em ML</span><input inputMode="decimal" value={opening} onChange={(event)=>setOpening(event.target.value)}/></label><label className="field"><span>Limite mínimo em ML</span><input inputMode="decimal" value={minimum} onChange={(event)=>setMinimum(event.target.value)}/></label><label className="field"><span>Data de referência</span><input type="date" value={reference} onChange={(event)=>setReference(event.target.value)}/></label><label className="field wide"><span>Observação</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button onClick={close}>Cancelar</button><button className="primary" disabled={saving} onClick={submit}>{saving?'Salvando…':'Cadastrar estoque'}</button></div></div></div></div>
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath())
  const [routePath,setRoutePath]=useState(location.pathname)
  const [period,setPeriod]=useState<PeriodValue>(defaultPeriod())
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(()=>{const change=()=>{setPage(pageFromPath());setRoutePath(location.pathname)};addEventListener('popstate',change);return()=>removeEventListener('popstate',change)},[])
  const navigate=(next:Page)=>{history.pushState({},'',routes[next]);setRoutePath(location.pathname);setPage(next)}
  const content = useMemo<ReactNode>(() => {
    if (page === 'Visão Geral') return <Dashboard period={period} setPeriod={setPeriod}/>
    if (page === 'Clientes') { const clientId=routePath.match(/^\/clientes\/([0-9a-f-]{36})$/i)?.[1]; return clientId?<ClientDetailsPage clientId={clientId}/>:<ClientsPage period={period} setPeriod={setPeriod}/> }
    if (page === 'Vendas') {const saleId=routePath.match(/^\/vendas\/([0-9a-f-]{36})$/i)?.[1];return saleId?<SaleDetailsPage saleId={saleId}/>:<SalesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Entregas') {const shipmentId=routePath.match(/^\/entregas\/([0-9a-f-]{36})$/i)?.[1];return shipmentId?<ShipmentDetailsPage shipmentId={shipmentId}/>:<DeliveriesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Estoque') return <InventoryPage period={period} setPeriod={setPeriod}/>
    if (page === 'Relatórios') return <ReportsPage period={period} setPeriod={setPeriod}/>
    if (page === 'Importação') return <ImportPage/>
    if (page === 'IA') return <Intelligence period={period} setPeriod={setPeriod}/>
    if (page === 'Insights') return <Insights period={period}/>
    if(page==='Configurações')return <ShippingSettingsPage/>
    return <GenericPage page={page}/>
  }, [page,period,routePath])
  return <div className="app-shell"><Sidebar page={page} setPage={navigate} open={menuOpen} close={()=>setMenuOpen(false)}/><main><Header page={page} menu={()=>setMenuOpen(true)}/>{content}<footer className="internal-mugo-signature"><img src="/mugo-logo.png" alt="Mugô"/><span>RUAH Intelligence — desenvolvido pela Mugô</span></footer></main></div>
}
