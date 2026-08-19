import { useEffect, useState } from 'react'
import { AlertTriangle, DollarSign, Scale, TrendingUp } from 'lucide-react'
import { brl, integer } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { PerfumeMarginRow, fetchPerfumeMarginSummary, marginTone, summarizeMargin } from '../lib/cost-margin'
import { Metric } from '../components/shared/Metric'
import { EmptyState, PageHeader, StatusBadge, Table } from '../components/ui'

/** Roadmap Fase 8 — "Quanto custa? Qual margem gera?" (rota /relatorios/margem). */
export function MarginReportPage({ period, setPeriod }: { period: PeriodValue; setPeriod: (value: PeriodValue) => void }) {
  const [rows, setRows] = useState<PerfumeMarginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { fetchPerfumeMarginSummary(period).then(setRows).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a margem.')).finally(() => setLoading(false)) }, [period])

  const totals = summarizeMargin(rows)
  const marginPct = totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : null

  return <div className="page">
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Custo e margem" description="Receita real contra custo de aquisição, perfume por perfume." actions={<PeriodFilter value={period} onApply={setPeriod} />} />
    {error && <div className="notice"><AlertTriangle size={18} /><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando margem…</h3></div> :
      rows.length === 0 ? <EmptyState icon={Scale} title="Nenhuma venda no período" description="Escolha outro período para ver custo e margem." /> : <>
        <section className="metrics">
          <Metric label="Receita" value={brl(totals.revenue)} detail={`${integer(rows.length)} perfumes vendidos`} icon={DollarSign} />
          <Metric label="Custo conhecido" value={brl(totals.knownCost)} detail={totals.unpriced > 0 ? `${integer(totals.unpriced)} sem custo informado` : 'Todos os perfumes custeados'} icon={Scale} />
          <Metric label="Margem" value={brl(totals.margin)} detail={marginPct === null ? '—' : `${marginPct.toFixed(1).replace('.', ',')}% da receita conhecida`} icon={TrendingUp} tone={totals.margin < 0 ? 'cream' : 'gold'} />
        </section>
        <div className="card clients-table">
          <div className="clients-caption"><strong>{integer(rows.length)} perfumes no período</strong></div>
          <Table rowKey={(r) => r.perfume_id} rows={rows} columns={[
            { key: 'perfume', label: 'Perfume', render: (r) => <strong>{r.perfume_name}</strong> },
            { key: 'units', label: 'Unidades', hideOnMobile: true, render: (r) => integer(r.units_sold) },
            { key: 'ml', label: 'ML vendido', hideOnMobile: true, render: (r) => `${Number(r.total_ml).toLocaleString('pt-BR')} ml` },
            { key: 'revenue', label: 'Receita', render: (r) => brl(r.revenue) },
            { key: 'cost_ml', label: 'Custo/ml', hideOnMobile: true, render: (r) => r.average_cost_per_ml === null ? '—' : brl(r.average_cost_per_ml) },
            { key: 'margin', label: 'Margem', render: (r) => r.margin === null ? <StatusBadge tone="neutral">SEM CUSTO</StatusBadge> : <StatusBadge tone={marginTone(r.margin_pct)}>{brl(r.margin)}{r.margin_pct !== null && ` · ${r.margin_pct.toFixed(1).replace('.', ',')}%`}</StatusBadge> },
          ]} />
        </div>
      </>}
  </div>
}
