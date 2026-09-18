import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock3, Download, Scale, TrendingUp, Truck, X } from 'lucide-react'
import { brl, integer } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue, previousPeriod } from '../lib/period'
import { exportCsv } from '../lib/csv'
import { PeriodSummary, fetchPeriodSummary } from '../lib/records'
import { goToMarginReport } from '../lib/cost-margin'
import { Metric } from '../components/shared/Metric'
import { PageHeader, SecondaryButton } from '../components/ui'

export function ReportsPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [current,setCurrent]=useState<PeriodSummary|null>(null),[previous,setPrevious]=useState<PeriodSummary|null>(null)
  useEffect(()=>{Promise.all([fetchPeriodSummary(period),fetchPeriodSummary(previousPeriod(period))]).then(([a,b])=>{setCurrent(a);setPrevious(b)})},[period])
  const variation=(now:number,before:number)=>before?`${(((now-before)/before)*100).toFixed(1).replace('.',',')}%`:'—'
  const rows=current?[{indicador:'Valor pago',atual:brl(Number(current.paid)),anterior:brl(Number(previous?.paid??0)),variacao:variation(Number(current.paid),Number(previous?.paid??0))},{indicador:'Vendas',atual:integer(current.sales),anterior:integer(previous?.sales??0),variacao:variation(current.sales,previous?.sales??0)},{indicador:'Ticket médio',atual:brl(Number(current.average_ticket)),anterior:brl(Number(previous?.average_ticket??0)),variacao:variation(Number(current.average_ticket),Number(previous?.average_ticket??0))},{indicador:'Clientes',atual:integer(current.buying_clients),anterior:integer(previous?.buying_clients??0),variacao:variation(current.buying_clients,previous?.buying_clients??0)}]:[]
  return <div className="page"><PageHeader eyebrow="INTELIGÊNCIA COMERCIAL" title="Relatórios" description="Resumo financeiro e comparação matemática entre períodos." actions={<><PeriodFilter value={period} onApply={setPeriod}/><SecondaryButton icon={<Scale size={16}/>} onClick={goToMarginReport}>Custo e margem</SecondaryButton><SecondaryButton icon={<Download size={16}/>} onClick={()=>exportCsv('relatorio.csv',rows)}>Exportar</SecondaryButton></>}/>
    {!current?<div className="empty card"><h3>Carregando relatório…</h3></div>:<><section className="metrics"><Metric label="Pagamentos" value={integer(current.paid_count)} detail={brl(Number(current.paid))} icon={Check}/><Metric label="Aguardando" value={integer(current.pending_count)} detail={brl(Number(current.pending))} icon={Clock3}/><Metric label="Canceladas" value={integer(current.cancelled_count)} detail={brl(Number(current.cancelled))} icon={X}/><Metric label="Em revisão" value={integer(current.review_count)} detail={brl(Number(current.review))} icon={AlertTriangle}/><Metric label="Ticket médio" value={brl(Number(current.average_ticket))} detail={`${integer(current.buying_clients)} clientes`} icon={TrendingUp}/><Metric label="Entregas pendentes" value={integer(current.deliveries_pending)} detail={`${integer(current.deliveries_overdue)} atrasadas`} icon={Truck}/></section><div className="card clients-table"><div className="clients-caption"><strong>Comparação com o período anterior</strong></div><table><thead><tr><th>Indicador</th><th>Atual</th><th>Anterior</th><th>Variação</th></tr></thead><tbody>{rows.map((row)=><tr key={row.indicador}><td>{row.indicador}</td><td>{row.atual}</td><td>{row.anterior}</td><td>{row.variacao}</td></tr>)}</tbody></table></div></>}
  </div>
}
