import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, UserRound } from 'lucide-react'
import { CustomerRequestQueueEntry, claimCustomerShipmentRequest, fetchCustomerShipmentRequestsQueue, quoteCustomerShipmentRequest } from '../lib/customer-requests-queue'
import { shortDate } from '../lib/format'
import { EmptyState, SecondaryButton } from './ui'

/** "Entregas → Solicitações de clientes": fila de pedidos feitos no
 * Portal do Cliente. Reivindicar usa o mesmo task_assign/task_resolve já
 * usado por vendas bloqueadas/waitlist/recuperação — nenhuma fila
 * paralela. "COTAR FRETE" cria o shipment real (endereço já confirmado
 * pela cliente) e leva a equipe direto para o fluxo operacional já
 * existente — nenhuma etiqueta/checkout acontece aqui.
 */
export function CustomerRequestsQueue() {
  const [rows, setRows] = useState<CustomerRequestQueueEntry[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState('')
  const reload = () => fetchCustomerShipmentRequestsQueue().then(setRows).catch(() => setError('Não foi possível carregar as solicitações de clientes.')).finally(() => setLoading(false))
  useEffect(() => { reload() }, [])
  const claim = async (id: string) => { setBusy(id); try { await claimCustomerShipmentRequest(id); reload() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível reivindicar.') } finally { setBusy('') } }
  const quote = async (id: string) => {
    setBusy(id); setError('')
    try { const shipmentId = await quoteCustomerShipmentRequest(id); history.pushState({}, '', `/entregas/${shipmentId}`); dispatchEvent(new PopStateEvent('popstate')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível cotar esta solicitação.') } finally { setBusy('') }
  }
  if (loading) return null
  if (error) return <div className="notice"><AlertTriangle /><span>{error}</span></div>
  if (rows.length === 0) return <EmptyState icon={UserRound} title="Nenhuma solicitação de cliente pendente" description="Pedidos feitos pela cliente no Portal do Cliente aparecem aqui." />
  return <div className="customer-requests-queue">
    {rows.map((row) => <div className="card customer-request-card" key={row.request_id}>
      <div><strong>{row.client_name}</strong><span>{row.total_ml} ml · {row.item_count} {row.item_count === 1 ? 'item' : 'itens'} · {shortDate(row.requested_at)}</span>
        <small>{row.items?.map((i) => `${i.perfume} (${i.quantity_ml}ml)`).join(', ')}</small></div>
      <div className="customer-request-actions">
        {row.assigned_to_name ? <span className="badge pending">Com {row.assigned_to_name}</span> : <SecondaryButton disabled={busy === row.request_id} onClick={() => claim(row.request_id)}>Reivindicar</SecondaryButton>}
        <SecondaryButton disabled={busy === row.request_id} onClick={() => quote(row.request_id)} icon={<ChevronRight size={14} />}>Cotar frete</SecondaryButton>
      </div>
    </div>)}
  </div>
}
