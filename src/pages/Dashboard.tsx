import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowUpRight, ChartNoAxesCombined, Clock3, ShoppingBag, Sparkles, TrendingUp, X } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { brl, integer, shortDate } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { DashboardActivityItem, PeriodSummary, fetchDashboardActivity, fetchPeriodSummary } from '../lib/records'
import { fetchReplenishmentSignals, goToReplenishment } from '../lib/replenishment'
import { Metric } from '../components/shared/Metric'
import { SecondaryButton } from '../components/ui'
import './Dashboard.css'

export function Dashboard({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [live,setLive]=useState<PeriodSummary|null>(null)
  const [loadError,setLoadError]=useState('')
  const [operations,setOperations]=useState<{activity:DashboardActivityItem[];attention:DashboardActivityItem[]}>({activity:[],attention:[]})
  const [stockAlerts,setStockAlerts]=useState({repor:0,atencao:0})
  useEffect(()=>{fetchPeriodSummary(period).then(setLive).catch(()=>setLoadError('Não foi possível consultar o Supabase.'))},[period])
  useEffect(()=>{fetchDashboardActivity().then(setOperations).catch(()=>{})},[])
  // Só sinais determinísticos do estoque (reposição inteligente) — nunca inventa números aqui.
  useEffect(()=>{fetchReplenishmentSignals().then((signals)=>setStockAlerts({
    repor:signals.filter((signal)=>signal.status==='critico'||signal.status==='repor').length,
    atencao:signals.filter((signal)=>signal.status==='atencao').length,
  })).catch(()=>{})},[])
  const hasData = Boolean(live?.sales)
  const paid = Number(live?.paid ?? 0)
  const pending = Number(live?.pending ?? 0)
  const cancelled = Number(live?.cancelled ?? 0)
  const total = paid + pending + cancelled
  const paymentData = live?.payment_methods??[]
  const colors = ['#bf9636', '#332f29', '#817768', '#ded6c8', '#9f7c2b']
  return <div className="page dashboard-page">
    <div className="page-lead dashboard-lead">
      <div><span className="dashboard-eyebrow">HOJE NA RUAH</span><h2>Visão executiva</h2><p>Uma leitura precisa do comercial, dos recebimentos e da operação.</p></div>
      <PeriodFilter value={period} onApply={setPeriod}/>
    </div>
    {loadError && <div className="notice"><AlertTriangle size={18} /><span>{loadError}</span></div>}
    {(stockAlerts.repor > 0 || stockAlerts.atencao > 0) && <section className="card attention-card">
      <span className="attention-eyebrow">O QUE PRECISA DA SUA ATENÇÃO</span>
      <div className="attention-row">
        <div>
          <strong>ESTOQUE</strong>
          <p>
            {stockAlerts.repor > 0 && <>{stockAlerts.repor} perfume{stockAlerts.repor === 1 ? '' : 's'} precisa{stockAlerts.repor === 1 ? '' : 'm'} de reposição</>}
            {stockAlerts.repor > 0 && stockAlerts.atencao > 0 && <br />}
            {stockAlerts.atencao > 0 && <>{stockAlerts.atencao} está{stockAlerts.atencao === 1 ? '' : 'ão'} em atenção</>}
          </p>
        </div>
        <SecondaryButton onClick={goToReplenishment}>Ver reposições</SecondaryButton>
      </div>
    </section>}
    <section className="executive-hero" aria-label="Resumo executivo"><div className="executive-primary"><span>VENDAS NO PERÍODO</span><strong>{hasData?brl(Number(live!.total)):'—'}</strong><small>{hasData?`${integer(Number(live!.sales))} relações comerciais`:'Aguardando dados reais'}</small></div><div className="executive-secondary"><div><span>RECEBIDO</span><strong>{hasData?brl(paid):'—'}</strong></div><div><span>PENDENTE</span><strong>{hasData?brl(pending):'—'}</strong></div><div><span>ATENÇÃO OPERACIONAL</span><strong>{hasData?integer(Number(live!.deliveries_pending)+Number(live!.deliveries_overdue)):'—'}</strong><small>entregas pendentes + atrasadas</small></div></div></section>
    <section className="metrics">
      <Metric label="Vendas realizadas" value={hasData ? integer(Number(live!.sales)) : '—'} detail={period.label} icon={ShoppingBag} />
      <Metric label="Ticket médio" value={hasData ? brl(Number(live!.average_ticket)) : '—'} detail="Valor por relação" icon={TrendingUp} />
      <Metric label="Cancelado" value={hasData ? brl(cancelled) : '—'} detail={hasData ? 'Fora do faturamento' : 'Aguardando dados'} icon={X} tone="cream" />
      <Metric label="Em revisão" value={hasData ? brl(Number(live!.review)) : '—'} detail={hasData ? `${integer(Number(live!.review_count))} registros` : 'Aguardando dados'} icon={Clock3} tone="sand" />
    </section>
    {hasData && <section className="coverage card">
      <div><span>Ticket médio</span><strong>{brl(Number(live!.average_ticket))}</strong></div>
      <div><span>Clientes compradores</span><strong>{integer(Number(live!.buying_clients))}</strong></div>
      <div><span>Novos clientes</span><strong>{integer(Number(live!.new_clients))}</strong></div>
      <div><span>Clientes recorrentes</span><strong>{integer(Number(live!.recurring_clients))}</strong></div>
      <div><span>Entregas pendentes</span><strong>{integer(Number(live!.deliveries_pending))}</strong></div>
      <div><span>Entregas atrasadas</span><strong>{integer(Number(live!.deliveries_overdue))}</strong></div>
    </section>}
    <section className="operations-activity card" aria-labelledby="activity-title"><header><span>OPERAÇÃO</span><h3 id="activity-title">Atividade e atenção</h3></header><div className="operations-columns"><div><h4>ATENÇÃO</h4>{operations.attention.length?operations.attention.map(item=><a key={item.id} href={item.href}><AlertTriangle/><span>{item.message}</span><ArrowUpRight/></a>):<p>Nenhuma pendência operacional identificada.</p>}</div><div><h4>HOJE</h4>{operations.activity.length?operations.activity.map(item=><a key={item.id} href={item.href}><time>{item.created_at?new Date(item.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—'}</time><span>{item.message}</span></a>):<p>Nenhuma atividade auditável registrada hoje.</p>}</div></div></section>
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
