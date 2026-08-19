import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Filter, Plus, Sparkles, X } from 'lucide-react'
import { brl, integer, shortDate } from '../lib/format'
import { SaleModal } from '../components/RecordModals'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { operationalLabel, statusLabel } from '../lib/presentation'
import { exportCsv } from '../lib/csv'
import { deliveryLabel } from '../lib/delivery'
import { CommercialSale, SaleFilters, fetchSalesPage } from '../lib/records'
import { BlockedSale, assignBlockedSale, blockingReasonLabels, fetchSalesValidationQueue } from '../lib/sales-validation'
import { Drawer, PageHeader, PrimaryButton, SearchInput, SecondaryButton, StatusBadge, Table } from '../components/ui'
import { AiSalesBatchImport } from '../components/AiSalesBatchImport'
import './SalesPage.css'

export function SalesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [modal,setModal]=useState(false)
  const [aiImport,setAiImport]=useState(false)
  const [sales,setSales]=useState<CommercialSale[]>([])
  const [count,setCount]=useState(0)
  const [page,setPage]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [filters,setFilters]=useState<SaleFilters>({period,sort:'sale_date_desc'})
  const [filtersOpen,setFiltersOpen]=useState(false)
  const [tab,setTab]=useState<'todas'|'bloqueadas'>(new URLSearchParams(location.search).get('filtro')==='bloqueadas'?'bloqueadas':'todas')
  const [blocked,setBlocked]=useState<BlockedSale[]>([]),[blockedLoading,setBlockedLoading]=useState(true)
  const details:CommercialSale|null=null
  const setDetails=(sale:CommercialSale|null)=>{if(sale){history.pushState({},'',`/vendas/${sale.id}`);dispatchEvent(new PopStateEvent('popstate'))}}
  const openBlockedSale=(sale:BlockedSale)=>{history.pushState({},'',`/vendas/${sale.sale_id}`);dispatchEvent(new PopStateEvent('popstate'))}
  const setFilter=(key:keyof SaleFilters,value:string)=>{setPage(0);setFilters((current)=>({...current,[key]:value||undefined}))}
  const activeFilterCount=Object.entries(filters).filter(([key,value])=>key!=='period'&&key!=='sort'&&key!=='search'&&value!==undefined&&value!=='').length
  const clearFilters=()=>{setPage(0);setFilters({period,sort:'sale_date_desc'})}
  const refresh=useCallback(()=>fetchSalesPage({...filters,period},page,50).then((result)=>{setSales(result.rows);setCount(result.count)}).catch(()=>setError('Não foi possível consultar as vendas.')).finally(()=>setLoading(false)),[filters,page,period])
  useEffect(()=>{refresh()},[refresh])
  // Fase 2 do roadmap operacional ("Qual venda está bloqueada?"): a contagem
  // carrega sempre, independente da aba ativa, para o rótulo "Bloqueadas (N)"
  // já avisar o Davi antes de ele precisar clicar.
  const reloadBlocked=()=>fetchSalesValidationQueue().then(setBlocked).catch(()=>setError('Não foi possível consultar as vendas bloqueadas.')).finally(()=>setBlockedLoading(false))
  useEffect(()=>{reloadBlocked()},[])
  // Fase 5 (Task Delegation): assumir não "resolve" a pendência sozinho — a
  // venda só sai da lista quando o dado que falta é realmente corrigido (a
  // consulta já reflete isso ao vivo). Assumir só evita duas pessoas
  // mexerem na mesma venda ao mesmo tempo.
  const assignBlocked=async(sale:BlockedSale)=>{try{await assignBlockedSale(sale.sale_id);await reloadBlocked()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível assumir esta venda.')}}
  const total=sales.reduce((sum,sale)=>sum+Number(sale.amount),0)

  return <div className="page">
    {modal&&<SaleModal close={()=>setModal(false)}/>} 
    {aiImport&&<AiSalesBatchImport close={()=>setAiImport(false)} completed={()=>{setLoading(true);refresh()}}/>}
    {details&&<SaleDetails sale={details} close={()=>setDetails(null)}/>}
    <PageHeader title="Vendas" description="Consulta, edição e exportação dos registros reais." actions={<>
      <PeriodFilter value={period} onApply={setPeriod}/>
      <SecondaryButton icon={<Sparkles size={16}/>} onClick={()=>setAiImport(true)}>Importar lista com IA</SecondaryButton>
      <SecondaryButton icon={<Download size={16}/>} onClick={()=>exportCsv('vendas-ruah.csv',sales as unknown as Record<string,unknown>[])}>Exportar</SecondaryButton>
      <PrimaryButton icon={<Plus size={16}/>} onClick={()=>setModal(true)}>Nova venda</PrimaryButton>
    </>}/>

    <div className="tabs sales-tabs">
      <button className={tab==='todas'?'selected':''} onClick={()=>setTab('todas')}>Todas</button>
      <button className={tab==='bloqueadas'?'selected':''} onClick={()=>setTab('bloqueadas')}>Bloqueadas {!blockedLoading&&`(${blocked.length})`}</button>
    </div>

    {tab==='bloqueadas'?
      blockedLoading?<div className="empty card"><h3>Carregando vendas bloqueadas…</h3></div>:
      blocked.length===0?<div className="empty card"><h3>Nenhuma venda bloqueada</h3><p>Todas as vendas pagas ou aguardando têm os dados necessários para seguir para o envio.</p></div>:
      <div className="card clients-table"><div className="clients-caption"><strong>{integer(blocked.length)} vendas precisam de atenção</strong></div>
        <Table rowKey={(sale)=>sale.sale_id} rows={blocked} onRowClick={openBlockedSale} columns={[
          {key:'sale_date',label:'Data',render:(sale)=>shortDate(sale.sale_date)},
          {key:'client',label:'Cliente',render:(sale)=><strong>{sale.client_name}</strong>},
          {key:'perfume',label:'Perfume',render:(sale)=>sale.perfume_name??'—'},
          {key:'amount',label:'Valor',render:(sale)=>brl(Number(sale.amount))},
          {key:'reasons',label:'Motivo',render:(sale)=><div className="sales-blocking-reasons">{blockingReasonLabels(sale.blocking_reasons).map((label)=><StatusBadge key={label} tone="warning">{label}</StatusBadge>)}</div>},
          {key:'assignee',label:'Responsável',render:(sale)=>sale.assigned_to_name?<StatusBadge tone="neutral">{sale.assigned_to_name}</StatusBadge>:<button onClick={(event)=>{event.stopPropagation();assignBlocked(sale)}}>Assumir</button>},
          {key:'actions',label:'Ações',render:(sale)=><button onClick={(event)=>{event.stopPropagation();openBlockedSale(sale)}}>Resolver</button>},
        ]}/>
      </div>
    :<>
    <div className="sales-toolbar">
      <SearchInput value={filters.search??''} onChange={(value)=>setFilter('search',value)} placeholder="Buscar cliente, perfume ou observação…"/>
      <select value={filters.status??''} onChange={(event)=>setFilter('status',event.target.value)}><option value="">Todos os pagamentos</option><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Revisão</option></select>
      <select value={filters.sort??''} onChange={(event)=>setFilter('sort',event.target.value)}><option value="sale_date_desc">Mais recentes</option><option value="sale_date_asc">Mais antigas</option><option value="amount_desc">Maior valor</option><option value="client_name_raw_asc">Cliente A–Z</option><option value="perfume_name_raw_asc">Perfume A–Z</option></select>
      <SecondaryButton icon={<Filter size={16}/>} onClick={()=>setFiltersOpen(true)}>{activeFilterCount>0?`Filtros (${activeFilterCount})`:'Filtros'}</SecondaryButton>
    </div>

    <Drawer open={filtersOpen} onClose={()=>setFiltersOpen(false)} side="right" aria-label="Mais filtros de vendas">
      <div className="sales-filters-drawer">
        <h3>Mais filtros</h3>
        <label className="field"><span>Cliente</span><input value={filters.client??''} onChange={(event)=>setFilter('client',event.target.value)} placeholder="Nome do cliente"/></label>
        <label className="field"><span>Perfume</span><input value={filters.perfume??''} onChange={(event)=>setFilter('perfume',event.target.value)} placeholder="Nome do perfume"/></label>
        <label className="field"><span>Tipo</span><select value={filters.type??''} onChange={(event)=>setFilter('type',event.target.value)}><option value="">Todos</option><option>APC</option><option>SPLIT</option></select></label>
        <label className="field"><span>Volume</span><input inputMode="decimal" value={filters.volumeMl??''} onChange={(event)=>setFilters((current)=>({...current,volumeMl:event.target.value?Number(event.target.value):undefined}))} placeholder="ML"/></label>
        <label className="field"><span>Forma de pagamento</span><select value={filters.method??''} onChange={(event)=>setFilter('method',event.target.value)}><option value="">Todas</option><option>PIX</option><option>CARTÃO</option><option>DEPÓSITO</option></select></label>
        <label className="field"><span>Origem</span><select value={filters.origin??''} onChange={(event)=>setFilter('origin',event.target.value)}><option value="">Todas</option><option value="spreadsheet">Importação</option><option value="manual">Manual</option></select></label>
        <label className="field"><span>Valor mínimo</span><input inputMode="decimal" value={filters.minValue??''} onChange={(event)=>setFilters((current)=>({...current,minValue:event.target.value?Number(event.target.value):undefined}))} placeholder="R$ 0,00"/></label>
        <label className="field"><span>Valor máximo</span><input inputMode="decimal" value={filters.maxValue??''} onChange={(event)=>setFilters((current)=>({...current,maxValue:event.target.value?Number(event.target.value):undefined}))} placeholder="Sem limite"/></label>
        <div className="sales-filters-actions">
          {activeFilterCount>0&&<SecondaryButton onClick={clearFilters}>Limpar filtros</SecondaryButton>}
          <PrimaryButton onClick={()=>setFiltersOpen(false)}>Aplicar</PrimaryButton>
        </div>
      </div>
    </Drawer>

    {loading?<div className="empty card"><h3>Carregando vendas…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(count)} vendas filtradas</strong><span>{brl(total)} nesta página</span></div><span className="live-dot">SUPABASE</span></div>
      <Table
        rowKey={(sale)=>sale.id}
        rows={sales}
        onRowClick={(sale)=>setDetails(sale)}
        columns={[
          {key:'sale_date',label:'Data',render:(sale)=>sale.sale_date?shortDate(sale.sale_date):'—'},
          {key:'client',label:'Cliente',render:(sale)=><strong>{sale.clients?.name??sale.original_client??'—'}</strong>},
          {key:'perfume_name_raw',label:'Perfume',render:(sale)=>sale.perfume_name_raw??'—'},
          {key:'sale_type',label:'Tipo',render:(sale)=>sale.sale_type??'—'},
          {key:'volume_ml',label:'ML',render:(sale)=>sale.volume_ml===null?'Revisar':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ml`},
          {key:'amount',label:'Valor',render:(sale)=>brl(Number(sale.amount))},
          {key:'payment_status',label:'Pagamento',render:(sale)=><span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]}</span>},
          {key:'payment_method',label:'Forma',render:(sale)=>sale.payment_method??'—'},
          {key:'shipped_at',label:'Entrega',render:(sale)=>deliveryLabel(sale)},
          {key:'source',label:'Origem',render:(sale)=>sale.source==='spreadsheet'?'Importação':'Manual'},
          {key:'actions',label:'Ações',render:(sale)=><button onClick={(event)=>{event.stopPropagation();setDetails(sale)}}>Ver detalhes</button>},
        ]}
      />
      <div className="table-foot"><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.max(1,Math.ceil(count/50))}</span><button disabled={(page+1)*50>=count} onClick={()=>setPage(page+1)}>Próxima</button></div>
    </div>}
    </>}
  </div>
}

function SaleDetails({sale,close}:{sale:CommercialSale;close:()=>void}){const shipment=sale.shipment_items?.[0]?.shipments,days=sale.sale_date&&sale.shipped_at?Math.round((new Date(sale.shipped_at).valueOf()-new Date(sale.sale_date).valueOf())/86400000):null;return <div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={close}/><div className="modal-panel"><div className="modal-title"><div><span>VENDA E LOGÍSTICA</span><h2>{sale.clients?.name??sale.original_client??'Venda'}</h2></div><button onClick={close}><X/></button></div><div className="client-grid"><article className="card client-panel"><h3>Compra</h3><dl><dt>Perfume</dt><dd>{sale.perfume_name_raw??'—'}</dd><dt>Data</dt><dd>{sale.sale_date?shortDate(sale.sale_date):'—'}</dd><dt>Valor</dt><dd>{brl(Number(sale.amount))}</dd><dt>Pagamento</dt><dd>{statusLabel[sale.payment_status]}</dd></dl></article><article className="card client-panel"><h3>Logística</h3><dl><dt>Fonte</dt><dd>{shipment?'Envio operacional':'Histórico legado'}</dd><dt>Status</dt><dd>{shipment?.status?operationalLabel(shipment.status):deliveryLabel(sale)}</dd><dt>Prazo previsto</dt><dd>{sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'}</dd><dt>Data efetiva</dt><dd>{sale.shipped_at?shortDate(sale.shipped_at):shipment?.posted_at?shortDate(shipment.posted_at):'—'}</dd><dt>Tempo até envio</dt><dd>{days===null?'—':`${days} dias`}</dd><dt>Transportadora</dt><dd>{shipment?.carrier??'—'}</dd><dt>Rastreio</dt><dd>{shipment?.tracking_code??'—'}</dd><dt>Entrega</dt><dd>{shipment?.delivered_at?shortDate(shipment.delivered_at):'—'}</dd></dl></article></div></div></div>}
