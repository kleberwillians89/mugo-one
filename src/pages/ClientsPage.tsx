import { useEffect, useState } from 'react'
import { AlertTriangle, Plus, Search } from 'lucide-react'
import { brl, integer, shortDate } from '../lib/format'
import { ClientModal } from '../components/RecordModals'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { fetchClientPeriodSummaries } from '../lib/records'

export function ClientsPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
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
