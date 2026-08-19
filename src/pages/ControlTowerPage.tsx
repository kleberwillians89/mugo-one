import { ReactNode, useEffect, useState } from 'react'
import { Compass, ShoppingBag, Truck, UsersRound } from 'lucide-react'
import { ControlTowerSummary, fetchControlTowerSummary } from '../lib/control-tower'
import { goToClientRecovery } from '../lib/client-recovery'
import { goToSalesBlocked } from '../lib/sales-validation'
import { goToWaitlist } from '../lib/waitlist'
import { goToReplenishment } from '../lib/replenishment'
import { goToMarginReport } from '../lib/cost-margin'
import { PageHeader, StatusBadge } from '../components/ui'
import './ControlTowerPage.css'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

function goToShipment(id: string) { history.pushState({}, '', `/entregas/${id}`); dispatchEvent(new PopStateEvent('popstate')) }
function goToDeliveries() { history.pushState({}, '', '/entregas'); dispatchEvent(new PopStateEvent('popstate')) }
function goToInventory() { history.pushState({}, '', '/estoque'); dispatchEvent(new PopStateEvent('popstate')) }

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
  const [summary, setSummary] = useState<ControlTowerSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { fetchControlTowerSummary().then(setSummary).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a torre de controle.')).finally(() => setLoading(false)) }, [])

  return <div className="page control-tower-page">
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Torre de Controle" description="Onde a operação está travando — em três perguntas, uma por pessoa." />
    {error && <div className="notice"><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando torre de controle…</h3></div> :
      summary && <div className="control-tower-grid">
        <Column icon={UsersRound} title="Davi" subtitle="Atendimento e vendas">
          <Row label="Vendas bloqueadas" value={String(summary.davi.blockedSalesCount)} tone={summary.davi.blockedSalesCount > 0 ? 'danger' : 'success'} onClick={goToSalesBlocked} />
          <Row label="Clientes em recuperação" value={String(summary.davi.recoveryCount)} tone={summary.davi.recoveryCount > 0 ? 'warning' : 'success'} onClick={goToClientRecovery} />
          <Row label="Prontos para avisar" value={String(summary.davi.waitlistReadyCount)} tone={summary.davi.waitlistReadyCount > 0 ? 'success' : 'neutral'} onClick={goToWaitlist} />
          <Row label="Esperando perfume" value={String(summary.davi.waitlistWaitingCount)} tone="neutral" onClick={goToWaitlist} />
        </Column>

        <Column icon={Truck} title="Ilde" subtitle="Separação e envio">
          <Row
            label="Próximo pedido"
            value={summary.ilde.nextShipment ? (summary.ilde.nextShipment.urgent ? `${summary.ilde.nextShipment.recipientName} — URGENTE` : summary.ilde.nextShipment.recipientName) : 'Fila vazia'}
            tone={summary.ilde.nextShipment?.urgent ? 'danger' : summary.ilde.nextShipment ? 'neutral' : 'success'}
            onClick={() => summary.ilde.nextShipment ? goToShipment(summary.ilde.nextShipment.id) : goToDeliveries()}
          />
          <Row label="Fila de preparo" value={String(summary.ilde.queueLength)} tone={summary.ilde.queueLength > 0 ? 'neutral' : 'success'} onClick={goToDeliveries} />
          {summary.ilde.pendingPhysicalConference > 0 && <Row label="Aguardando conferência física" value={String(summary.ilde.pendingPhysicalConference)} tone="warning" onClick={goToDeliveries} />}
        </Column>

        <Column icon={ShoppingBag} title="Gestão" subtitle="Estoque, compra e margem">
          <Row label="Estoque baixo" value={String(summary.gestao.lowStockCount)} tone={summary.gestao.lowStockCount > 0 ? 'danger' : 'success'} onClick={goToReplenishment} />
          <Row label="Oportunidades fortes de compra" value={String(summary.gestao.strongOpportunityCount)} tone={summary.gestao.strongOpportunityCount > 0 ? 'success' : 'neutral'} onClick={goToReplenishment} />
          <Row label="Margem do mês" value={summary.gestao.marginPct !== null ? `${summary.gestao.marginPct.toFixed(1).replace('.', ',')}%` : '—'} tone={summary.gestao.marginPct === null ? 'neutral' : summary.gestao.marginPct < 0 ? 'danger' : summary.gestao.marginPct < 20 ? 'warning' : 'success'} onClick={goToMarginReport} />
          <Row label="Perfumes sem custo" value={String(summary.gestao.unpricedCount)} tone={summary.gestao.unpricedCount > 0 ? 'warning' : 'success'} onClick={goToInventory} />
        </Column>
      </div>}
  </div>
}
