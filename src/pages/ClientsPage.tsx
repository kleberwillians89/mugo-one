import { useEffect, useState } from 'react'
import { AlertTriangle, Plus, Search } from 'lucide-react'
import { brl, clientNumber, integer, shortDate } from '../lib/format'
import { ClientModal } from '../components/RecordModals'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { fetchClientPeriodSummaries } from '../lib/records'
import { PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'

export function ClientsPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [modal,setModal]=useState(false)
  const [clients,setClients]=useState<Record<string,unknown>[]>([])
  const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[order,setOrder]=useState('paid')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{fetchClientPeriodSummaries(period).then(setClients).catch(()=>setError('Não foi possível consultar os clientes.')).finally(()=>setLoading(false))},[period])
  const normalizedSearch=search.trim().toLowerCase()
  const visible=clients.filter((client)=>(String(client.client).toLowerCase().includes(normalizedSearch)||String(client.client_number??'').includes(normalizedSearch)||clientNumber(client.client_number as number).includes(normalizedSearch))&&(!status||client.relationship_status===status))
    .sort((a,b)=>order==='name'?String(a.client).localeCompare(String(b.client),'pt-BR'):Number(b[order])-Number(a[order]))
  return <div className="page clients-page">{modal&&<ClientModal close={()=>setModal(false)}/>}
    <PageHeader eyebrow="PRIVATE CLIENT SERVICE" title="Clientes" description="Relacionamento, recorrência e histórico no período." actions={<><PeriodFilter value={period} onApply={setPeriod}/><SecondaryButton onClick={()=>{history.pushState({},'','/clientes/acessos-minha-ruah');dispatchEvent(new PopStateEvent('popstate'))}}>Acessos em análise</SecondaryButton><PrimaryButton icon={<Plus size={16}/>} onClick={()=>setModal(true)}>Adicionar cliente</PrimaryButton></>}/>
    <div className="toolbar card"><div className="search"><Search size={18}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar cliente…"/></div>
      <select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="">Todos os status</option><option value="new">Novo</option><option value="recurring">Recorrente</option><option value="active">Ativo</option><option value="inactive">Inativo</option></select>
      <select value={order} onChange={(event)=>setOrder(event.target.value)}><option value="paid">Maior valor pago</option><option value="total_purchased">Maior valor total</option><option value="item_count">Mais compras</option><option value="average_ticket">Maior ticket</option><option value="name">Nome</option></select></div>
    {loading?<div className="empty card"><h3>Carregando clientes do Supabase…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(visible.length)} clientes</strong><span>Dados reais no período selecionado</span></div><span className="live-dot">SUPABASE</span></div>
      <Table rowKey={(c)=>String(c.client_id)} rows={visible} onRowClick={(c)=>{history.pushState({},'',`/clientes/${c.client_id}`);dispatchEvent(new PopStateEvent('popstate'))}} columns={[
        {key:'client_number',label:'Nº',render:(c)=><span className="client-number">{clientNumber(c.client_number as number)}</span>},
        {key:'client',label:'Cliente',render:(c)=><strong className="client-primary-name">{String(c.client)}{c.has_gift?<span className="client-gift-flag" title="Cliente com brinde"> · 🎁 BRINDE</span>:null}</strong>},
        {key:'paid',label:'Pago',render:(c)=>brl(Number(c.paid))},{key:'pending',label:'Aguardando',render:(c)=>brl(Number(c.pending))},
        {key:'item_count',label:'Compras',render:(c)=>integer(Number(c.item_count))},{key:'average_ticket',label:'Ticket médio',render:(c)=>brl(Number(c.average_ticket))},
        {key:'top_perfume',label:'Perfume preferido',render:(c)=>String(c.top_perfume??'—')},{key:'total_ml',label:'Volume',render:(c)=>`${Number(c.total_ml).toLocaleString('pt-BR')} ml`},
        {key:'relationship_status',label:'Relação',render:(c)=><StatusBadge tone={c.relationship_status==='recurring'?'success':'neutral'}>{String(c.relationship_status)}</StatusBadge>},
        {key:'last_purchase',label:'Última compra',render:(c)=>c.last_purchase?shortDate(String(c.last_purchase)):'—'},
        {key:'action',label:'Ação',render:()=><span className="table-action-copy">Abrir dossiê</span>},
      ]}/>
    </div>}
  </div>
}
