import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Plus, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { brl, integer, shortDate } from '../lib/format'
import { SaleModal } from '../components/RecordModals'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { operationalLabel, statusLabel } from '../lib/presentation'
import { exportCsv } from '../lib/csv'
import { deliveryLabel } from '../lib/delivery'
import { CommercialSale, SaleFilters, fetchSalesPage } from '../lib/records'

export function SalesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [modal,setModal]=useState(false)
  const [sales,setSales]=useState<CommercialSale[]>([])
  const [count,setCount]=useState(0)
  const [page,setPage]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [filters,setFilters]=useState<SaleFilters>({period,sort:'sale_date_desc'})
  const [showMoreFilters,setShowMoreFilters]=useState(false)
  const details:CommercialSale|null=null
  const setDetails=(sale:CommercialSale|null)=>{if(sale){history.pushState({},'',`/vendas/${sale.id}`);dispatchEvent(new PopStateEvent('popstate'))}}
  const setFilter=(key:keyof SaleFilters,value:string)=>{setPage(0);setFilters((current)=>({...current,[key]:value||undefined}))}
  const activeFilterCount=Object.entries(filters).filter(([key,value])=>key!=='period'&&key!=='sort'&&value!==undefined&&value!=='').length
  const clearFilters=()=>{setPage(0);setFilters({period,sort:'sale_date_desc'})}
  useEffect(()=>{fetchSalesPage({...filters,period},page,50).then((result)=>{setSales(result.rows);setCount(result.count)}).catch(()=>setError('Não foi possível consultar as vendas.')).finally(()=>setLoading(false))},[filters,page,period])
  const total=sales.reduce((sum,sale)=>sum+Number(sale.amount),0)
  return <div className="page">{modal&&<SaleModal close={()=>setModal(false)}/>} {details&&<SaleDetails sale={details} close={()=>setDetails(null)}/>}<div className="page-lead"><div><h2>Vendas</h2><p>Consulta, edição e exportação dos registros reais.</p></div><div className="page-actions"><PeriodFilter value={period} onApply={setPeriod}/><button onClick={()=>exportCsv('vendas-ruah.csv',sales as unknown as Record<string,unknown>[])}><Download size={17}/> Exportar CSV</button><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> Nova venda</button></div></div>
    <div className="sales-filter-panel card">
      <div className="filter-primary"><div className="search"><Search size={18}/><input value={filters.search??''} onChange={(event)=>setFilter('search',event.target.value)} placeholder="Buscar cliente, perfume ou observação…"/></div>
        <select value={filters.status??''} onChange={(event)=>setFilter('status',event.target.value)}><option value="">Todos os pagamentos</option><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Revisão</option></select>
        <select value={filters.sort??''} onChange={(event)=>setFilter('sort',event.target.value)}><option value="sale_date_desc">Mais recentes</option><option value="sale_date_asc">Mais antigas</option><option value="amount_desc">Maior valor</option><option value="client_name_raw_asc">Cliente A–Z</option><option value="perfume_name_raw_asc">Perfume A–Z</option></select>
        <button className={showMoreFilters?'filter-toggle active':'filter-toggle'} onClick={()=>setShowMoreFilters(!showMoreFilters)}><SlidersHorizontal/> Mais filtros {activeFilterCount>0&&<i>{activeFilterCount}</i>}</button>
        {activeFilterCount>0&&<button className="filter-clear" onClick={clearFilters}><RotateCcw/> Limpar</button>}
      </div>
      {showMoreFilters&&<div className="filter-secondary">
        <label><span>Cliente</span><input value={filters.client??''} onChange={(event)=>setFilter('client',event.target.value)} placeholder="Nome do cliente"/></label>
        <label><span>Perfume</span><input value={filters.perfume??''} onChange={(event)=>setFilter('perfume',event.target.value)} placeholder="Nome do perfume"/></label>
        <label><span>Tipo</span><select value={filters.type??''} onChange={(event)=>setFilter('type',event.target.value)}><option value="">Todos</option><option>APC</option><option>SPLIT</option></select></label>
        <label><span>Volume</span><input inputMode="decimal" value={filters.volumeMl??''} onChange={(event)=>setFilters((current)=>({...current,volumeMl:event.target.value?Number(event.target.value):undefined}))} placeholder="ML"/></label>
        <label><span>Forma de pagamento</span><select value={filters.method??''} onChange={(event)=>setFilter('method',event.target.value)}><option value="">Todas</option><option>PIX</option><option>CARTÃO</option><option>DEPÓSITO</option></select></label>
        <label><span>Origem</span><select value={filters.origin??''} onChange={(event)=>setFilter('origin',event.target.value)}><option value="">Todas</option><option value="spreadsheet">Importação</option><option value="manual">Manual</option></select></label>
        <label><span>Valor mínimo</span><input inputMode="decimal" value={filters.minValue??''} onChange={(event)=>setFilters((current)=>({...current,minValue:event.target.value?Number(event.target.value):undefined}))} placeholder="R$ 0,00"/></label>
        <label><span>Valor máximo</span><input inputMode="decimal" value={filters.maxValue??''} onChange={(event)=>setFilters((current)=>({...current,maxValue:event.target.value?Number(event.target.value):undefined}))} placeholder="Sem limite"/></label>
      </div>}
    </div>
    {loading?<div className="empty card"><h3>Carregando vendas…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(count)} vendas filtradas</strong><span>{brl(total)} nesta página</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Forma</th><th>Data pagmt.</th><th>Prazo</th><th>Data envio</th><th>Entrega</th><th>Origem</th><th>Ações</th></tr></thead>
      <tbody>{sales.map((sale)=><tr key={sale.id}><td>{sale.sale_date?shortDate(sale.sale_date):'—'}</td><td><strong>{sale.clients?.name??sale.original_client??'—'}</strong></td><td>{sale.perfume_name_raw??'—'}</td><td>{sale.sale_type??'—'}</td><td>{sale.volume_ml===null?'Revisar':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ml`}</td><td>{brl(Number(sale.amount))}</td><td><span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]}</span></td><td>{sale.payment_method??'—'}</td><td>{sale.paid_at?shortDate(sale.paid_at):'—'}</td><td>{sale.shipping_deadline_raw||'—'}</td><td>{sale.shipped_at?shortDate(sale.shipped_at):'—'}</td><td>{deliveryLabel(sale)}</td><td>{sale.source==='spreadsheet'?'Importação':'Manual'}</td><td><button onClick={()=>setDetails(sale)}>Ver detalhes</button></td></tr>)}</tbody></table></div>
      <div className="table-foot"><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.max(1,Math.ceil(count/50))}</span><button disabled={(page+1)*50>=count} onClick={()=>setPage(page+1)}>Próxima</button></div>
    </div>}
  </div>
}

function SaleDetails({sale,close}:{sale:CommercialSale;close:()=>void}){const shipment=sale.shipment_items?.[0]?.shipments,days=sale.sale_date&&sale.shipped_at?Math.round((new Date(sale.shipped_at).valueOf()-new Date(sale.sale_date).valueOf())/86400000):null;return <div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={close}/><div className="modal-panel"><div className="modal-title"><div><span>VENDA E LOGÍSTICA</span><h2>{sale.clients?.name??sale.original_client??'Venda'}</h2></div><button onClick={close}><X/></button></div><div className="client-grid"><article className="card client-panel"><h3>Compra</h3><dl><dt>Perfume</dt><dd>{sale.perfume_name_raw??'—'}</dd><dt>Data</dt><dd>{sale.sale_date?shortDate(sale.sale_date):'—'}</dd><dt>Valor</dt><dd>{brl(Number(sale.amount))}</dd><dt>Pagamento</dt><dd>{statusLabel[sale.payment_status]}</dd></dl></article><article className="card client-panel"><h3>Logística</h3><dl><dt>Fonte</dt><dd>{shipment?'Envio operacional':'Histórico legado'}</dd><dt>Status</dt><dd>{shipment?.status?operationalLabel(shipment.status):deliveryLabel(sale)}</dd><dt>Prazo previsto</dt><dd>{sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'}</dd><dt>Data efetiva</dt><dd>{sale.shipped_at?shortDate(sale.shipped_at):shipment?.posted_at?shortDate(shipment.posted_at):'—'}</dd><dt>Tempo até envio</dt><dd>{days===null?'—':`${days} dias`}</dd><dt>Transportadora</dt><dd>{shipment?.carrier??'—'}</dd><dt>Rastreio</dt><dd>{shipment?.tracking_code??'—'}</dd><dt>Entrega</dt><dd>{shipment?.delivered_at?shortDate(shipment.delivered_at):'—'}</dd></dl></article></div></div></div>}
