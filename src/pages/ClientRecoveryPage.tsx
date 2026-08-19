import { useEffect, useState } from 'react'
import { Phone, UserRound } from 'lucide-react'
import { brl, shortDate } from '../lib/format'
import { authenticatedOrganization } from '../lib/records'
import {
  ClientRecoveryEntry, assignClientRecovery, bestContact, fetchClientRecoveryQueue,
  recoveryUrgencyTone, resolveClientRecoveryTask,
} from '../lib/client-recovery'
import { EmptyState, PageHeader, StatusBadge, Table } from '../components/ui'
import './ClientRecoveryPage.css'

const openClient = (clientId: string) => { history.pushState({}, '', `/clientes/${clientId}`); dispatchEvent(new PopStateEvent('popstate')) }

/** Roadmap Fase 7 — "Quem está deixando de comprar?" (rota /clientes/recuperacao). */
export function ClientRecoveryPage() {
  const [entries, setEntries] = useState<ClientRecoveryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canManage, setCanManage] = useState(false)

  const reload = () => { fetchClientRecoveryQueue().then(setEntries).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a fila de recuperação.')).finally(() => setLoading(false)) }
  useEffect(reload, [])
  useEffect(() => { authenticatedOrganization().then((org) => setCanManage(['admin', 'manager', 'operator'].includes(org.role))).catch(() => {}) }, [])

  async function assign(entry: ClientRecoveryEntry) {
    try { await assignClientRecovery(entry.client_id); reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível assumir esta recuperação.') }
  }
  async function resolve(entry: ClientRecoveryEntry) {
    if (!entry.assignment_id) return
    try { await resolveClientRecoveryTask(entry.assignment_id); reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir esta recuperação.') }
  }

  return <div className="page">
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Recuperação de clientes" description="Clientes que já compraram e pararam — sem alerta, ninguém liga." />
    {error && <div className="notice"><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando clientes em risco…</h3></div> :
      entries.length === 0 ? <EmptyState icon={UserRound} title="Nenhum cliente em risco" description="Todo cliente com histórico de compras comprou novamente nos últimos 90 dias." /> :
      <div className="card clients-table">
        <div className="clients-caption"><strong>{entries.length} cliente{entries.length === 1 ? '' : 's'} sem comprar há 90+ dias</strong></div>
        <Table rowKey={(e) => e.client_id} rows={entries} columns={[
          { key: 'client', label: 'Cliente', render: (e) => <strong>{e.client_name}</strong> },
          { key: 'contact', label: 'Contato', hideOnMobile: true, render: (e) => <span className="recovery-contact"><Phone size={13} />{bestContact(e)}</span> },
          { key: 'last_purchase', label: 'Última compra', render: (e) => shortDate(e.last_purchase) },
          { key: 'days', label: 'Sem comprar', render: (e) => <StatusBadge tone={recoveryUrgencyTone(e.days_since_last_purchase)}>{e.days_since_last_purchase} dias</StatusBadge> },
          { key: 'total', label: 'Total histórico', hideOnMobile: true, render: (e) => brl(e.total_purchased) },
          { key: 'assignee', label: 'Responsável', render: (e) => e.assigned_to_name ? <StatusBadge tone="neutral">{e.assigned_to_name}</StatusBadge> : (canManage ? <button onClick={() => assign(e)}>Assumir</button> : '—') },
          { key: 'actions', label: 'Ações', render: (e) => <div className="recovery-actions">
            <button onClick={() => openClient(e.client_id)}>Ver dossiê</button>
            {canManage && e.assignment_id && <button onClick={() => resolve(e)}>Concluir</button>}
          </div> },
        ]} />
      </div>}
  </div>
}
