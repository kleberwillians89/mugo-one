import { useEffect, useState } from 'react'
import { Clock3, Sparkles } from 'lucide-react'
import { brl, integer } from '../lib/format'
import { PeriodValue } from '../lib/period'
import { PeriodSummary, fetchPeriodSummary } from '../lib/records'
import { EmptyConnect } from '../components/shared/EmptyConnect'
import { PageHeader, PrimaryButton } from '../components/ui'

export function Insights({period}:{period:PeriodValue}) {
  const [summary,setSummary]=useState<PeriodSummary|null>(null)
  useEffect(()=>{fetchPeriodSummary(period).then(setSummary).catch(()=>setSummary(null))},[period])
  const blocks=summary?[
    ['Pagamentos aguardando',`${integer(summary.pending_count)} vendas · ${brl(Number(summary.pending))}`],
    ['Entregas atrasadas',`${integer(summary.deliveries_overdue)} itens exigem atenção`],
    ['Clientes recorrentes',`${integer(summary.recurring_clients)} clientes no período`],
  ]:[]
  return <div className="page"><PageHeader eyebrow="INTELIGÊNCIA COMERCIAL" title="Insights comerciais" description="Recomendações práticas geradas a partir de métricas oficiais." actions={<PrimaryButton icon={<Sparkles size={17}/>}>Gerar novos insights</PrimaryButton>}/>
    <div className="insight-grid">
      {blocks.map(([title,text],i)=><article className="card insight-skeleton" key={title}><div><span>{title}</span><i>{i===1?'ALTO':'REAL'}</i></div><h3>{text}</h3><p>Calculado diretamente no Supabase para {period.label.toLowerCase()}.</p><footer><Clock3 size={14}/> Atualizado agora</footer></article>)}
    </div>
    {!summary&&<EmptyConnect title="Insights indisponíveis" text="Não foi possível consultar os agregados reais."/>}
  </div>
}
