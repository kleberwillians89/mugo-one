import { ReactNode, useEffect, useState } from 'react'
import { Compass, Scissors, ShoppingBag, Truck, UsersRound } from 'lucide-react'
import { ControlTowerSummary, fetchControlTowerSummary } from '../lib/control-tower'
import { goToClientRecovery } from '../lib/client-recovery'
import { goToSalesBlocked } from '../lib/sales-validation'
import { goToWaitlist } from '../lib/waitlist'
import { goToReplenishment } from '../lib/replenishment'
import { goToMarginReport } from '../lib/cost-margin'
import { PageHeader, StatusBadge } from '../components/ui'
import { usePermissions } from '../lib/PermissionsContext'
import './ControlTowerPage.css'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

function goToShipment(id: string) { history.pushState({}, '', `/entregas/${id}`); dispatchEvent(new PopStateEvent('popstate')) }
function goToDeliveries() { history.pushState({}, '', '/entregas'); dispatchEvent(new PopStateEvent('popstate')) }
function goToInventory() { history.pushState({}, '', '/estoque'); dispatchEvent(new PopStateEvent('popstate')) }
function goToSplits() { history.pushState({}, '', '/falta-splitar'); dispatchEvent(new PopStateEvent('popstate')) }

function Row({ label, value, tone, onClick }: { label: string; value: string; tone: Tone; onClick: () => void }) {
  return <button type="button" className="control-tower-row" onClick={onClick}>
    <span>{label}</span>
    <StatusBadge tone={tone}>{value}</StatusBadge>
  </button>
}

function Column({ icon: Icon, title, subtitle, children }: { icon: typeof Compass; title: string; subtitle: string; children: ReactNode }) {
  return <section className="card control-tower-column">
    <header><Icon size={18} /><div><strong>{title}</strong><span>{subtitle}</span></div></header>
    <div className="control-tower-rows">{children}</div>
  </section>
}

/** Roadmap — Torre de Controle: a tela final. Cada linha responde UMA pergunta de uma das três pessoas da operação, com um único clique até a tela real onde a ação acontece — a Torre nunca é onde se resolve nada, só onde se enxerga o que precisa de atenção. "ATTENTION / ACTION / EXCEPTION over vanity metrics": por isso cada coluna tem só 3-4 linhas, nunca uma parede de métricas. */
export function ControlTowerPage() {
  const {can}=usePermissions()
  const sales=can('tasks.sales'),split=can('tasks.split'),shipping=can('tasks.shipping'),management=can('tasks.management')
  const [summary, setSummary] = useState<ControlTowerSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { fetchControlTowerSummary({sales,split,shipping,management}).then(setSummary).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as tarefas.')).finally(() => setLoading(false)) }, [sales,split,shipping,management])

  return <div className="page control-tower-page">
    <PageHeader eyebrow="OPERAÇÃO" title="Tarefas" />
    {error && <div className="notice"><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando torre de controle…</h3></div> :
      summary && <div className="control-tower-grid">
        {summary.davi&&<Column icon={UsersRound} title="Davi" subtitle="Vendas">
          <Row label="Vendas bloqueadas" value={String(summary.davi.blockedSalesCount)} tone={summary.davi.blockedSalesCount > 0 ? 'danger' : 'success'} onClick={goToSalesBlocked} />
          <Row label="Clientes em recuperação" value={String(summary.davi.recoveryCount)} tone={summary.davi.recoveryCount > 0 ? 'warning' : 'success'} onClick={goToClientRecovery} />
          <Row label="Prontos para avisar" value={String(summary.davi.waitlistReadyCount)} tone={summary.davi.waitlistReadyCount > 0 ? 'success' : 'neutral'} onClick={goToWaitlist} />
          <Row label="Esperando perfume" value={String(summary.davi.waitlistWaitingCount)} tone="neutral" onClick={goToWaitlist} />
        </Column>}

        {summary.gabriel&&<Column icon={Scissors} title="Gabriel" subtitle="Splitar">
          <Row label="Não splitados" value={String(summary.gabriel.not_split)} tone={summary.gabriel.not_split>0?'danger':'success'} onClick={goToSplits}/>
          <Row label="Clientes pendentes" value={String(summary.gabriel.clients_pending)} tone={summary.gabriel.clients_pending>0?'warning':'success'} onClick={goToSplits}/>
          <Row label="Perfumes pendentes" value={String(summary.gabriel.perfumes_pending)} tone={summary.gabriel.perfumes_pending>0?'warning':'success'} onClick={goToSplits}/>
          <Row label="ML pendentes" value={`${Number(summary.gabriel.ml_pending).toLocaleString('pt-BR')} ML`} tone={summary.gabriel.ml_pending>0?'neutral':'success'} onClick={goToSplits}/>
        </Column>}

        {summary.entregas&&<Column icon={Truck} title="Emily e Ilde" subtitle="Entregas">
          <Row
            label="Próximo pedido"
            value={summary.entregas.nextShipment ? (summary.entregas.nextShipment.urgent ? `${summary.entregas.nextShipment.recipientName} — URGENTE` : summary.entregas.nextShipment.recipientName) : 'Fila vazia'}
            tone={summary.entregas.nextShipment?.urgent ? 'danger' : summary.entregas.nextShipment ? 'neutral' : 'success'}
            onClick={() => summary.entregas!.nextShipment ? goToShipment(summary.entregas!.nextShipment!.id) : goToDeliveries()}
          />
          <Row label="Fila de preparo" value={String(summary.entregas.queueLength)} tone={summary.entregas.queueLength > 0 ? 'neutral' : 'success'} onClick={goToDeliveries} />
          {summary.entregas.pendingPhysicalConference > 0 && <Row label="Aguardando conferência física" value={String(summary.entregas.pendingPhysicalConference)} tone="warning" onClick={goToDeliveries} />}
        </Column>}

        {summary.gestao&&<Column icon={ShoppingBag} title="Gestão" subtitle="Estoque, compra e margem">
          <Row label="Estoque baixo" value={String(summary.gestao.lowStockCount)} tone={summary.gestao.lowStockCount > 0 ? 'danger' : 'success'} onClick={goToReplenishment} />
          <Row label="Oportunidades fortes de compra" value={String(summary.gestao.strongOpportunityCount)} tone={summary.gestao.strongOpportunityCount > 0 ? 'success' : 'neutral'} onClick={goToReplenishment} />
          <Row label="Margem do mês" value={summary.gestao.marginPct !== null ? `${summary.gestao.marginPct.toFixed(1).replace('.', ',')}%` : '—'} tone={summary.gestao.marginPct === null ? 'neutral' : summary.gestao.marginPct < 0 ? 'danger' : summary.gestao.marginPct < 20 ? 'warning' : 'success'} onClick={goToMarginReport} />
          <Row label="Perfumes sem custo" value={String(summary.gestao.unpricedCount)} tone={summary.gestao.unpricedCount > 0 ? 'warning' : 'success'} onClick={goToInventory} />
        </Column>}
      </div>}
  </div>
}
