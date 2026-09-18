import { useEffect, useState } from 'react'
import { AlertTriangle, Filter, Plus, Truck } from 'lucide-react'
import { brl, integer, shortDate } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { todayIso, deliveryState, deliveryLabels } from '../lib/delivery'
import { NewShipmentModal, OperationalShipments } from '../components/ShipmentOperations'
import { CustomerRequestsQueue } from '../components/CustomerRequestsQueue'
import { LegacyShippingStatusInput } from '../components/LegacyShippingStatusInput'
import {
  CommercialSale, LogisticsSummary, type LegacyShippingStatusResult, fetchDeliveryRows, fetchLogisticsSummary, updateShipment,
} from '../lib/records'
import { countLegacyShippingStatuses, type LegacyShippingStatus } from '../lib/legacy-shipping-status'
import { Metric } from '../components/shared/Metric'
import { Divider, Drawer, Modal, PageHeader, PrimaryButton, SearchInput, SecondaryButton, SectionHeader, Table } from '../components/ui'
import './DeliveriesPage.css'
import type {ShippingTaskFilter} from '../lib/shipping-tasks'

export function DeliveriesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const routeParams=new URLSearchParams(location.search)
  const requestedTask=routeParams.get('task') as ShippingTaskFilter|null
  const preselectedSaleId=routeParams.get('sale')||undefined
  const [rows,setRows]=useState<CommercialSale[]>([]),[filter,setFilter]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [legacyStatusFilter,setLegacyStatusFilter]=useState<'all'|LegacyShippingStatus>('all')
  const [newShipment,setNewShipment]=useState(false),[historical,setHistorical]=useState<CommercialSale|null>(null),[historicalDate,setHistoricalDate]=useState(todayIso())
  const [summary,setSummary]=useState<LogisticsSummary|null>(null)
  const [filtersOpen,setFiltersOpen]=useState(false)
  const reload=()=>{Promise.all([fetchDeliveryRows(period),fetchLogisticsSummary(period)]).then(([sales,metrics])=>{setRows(sales);setSummary(metrics)}).catch(()=>setError('Não foi possível consultar as entregas.')).finally(()=>setLoading(false))}
  useEffect(reload,[period])
  const counts=rows.reduce((acc,row)=>{const key=deliveryState(row);acc[key]=(acc[key]??0)+1;return acc},{} as Record<string,number>),legacyCounts=countLegacyShippingStatuses(rows)
  const visible=rows.filter((row)=>(legacyStatusFilter==='all'||row.legacy_shipping_status===legacyStatusFilter)&&(!filter||deliveryState(row)===filter)&&(!search||`${row.original_client} ${row.perfume_name_raw}`.toLowerCase().includes(search.toLowerCase())))
  const register=async(row:CommercialSale,value:string|null)=>{try{await updateShipment(row.id,value);setHistorical(null);reload()}catch(err){setError(err instanceof Error?err.message:'Falha ao atualizar envio.')}}
  const applyLegacyStatus=(result:LegacyShippingStatusResult)=>setRows(current=>current.map(row=>row.id===result.sale_id?{...row,legacy_shipping_status:result.status,legacy_shipping_status_updated_at:result.status_updated_at,legacy_shipping_status_updated_by:result.status_updated_by,updated_at:result.updated_at}:row))

  return <div className="page">
    {(newShipment||routeParams.get('novo')==='1')&&<NewShipmentModal
      preselectedSaleId={preselectedSaleId}
      close={()=>{setNewShipment(false);if(location.search){history.replaceState({},'',location.pathname)}}}
    />}
    <Modal open={Boolean(historical)} onClose={()=>setHistorical(null)} eyebrow="LOGÍSTICA HISTÓRICA" title="Registrar envio histórico">
      {historical&&<div className="record-form">
        <p>Atualiza somente a data histórica da venda; não cria reserva nem envio operacional.</p>
        <label className="field"><span>Data do envio</span><input type="date" value={historicalDate} onChange={event=>setHistoricalDate(event.target.value)}/></label>
        <div className="form-actions">
          {historical.shipped_at&&<SecondaryButton onClick={()=>register(historical,null)}>Remover data</SecondaryButton>}
          <SecondaryButton onClick={()=>setHistorical(null)}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={!historicalDate} onClick={()=>register(historical,historicalDate)}>Salvar envio histórico</PrimaryButton>
        </div>
      </div>}
    </Modal>

    <PageHeader title="Entregas" description="Envios operacionais e registros históricos claramente separados." actions={<>
      <PeriodFilter value={period} onApply={setPeriod}/>
      <PrimaryButton icon={<Plus size={16}/>} onClick={()=>setNewShipment(true)}>Novo envio</PrimaryButton>
    </>}/>

    <SectionHeader title="Solicitações de clientes" description="Pedidos de envio feitos pela cliente no Portal do Cliente — cote o frete para continuar pelo fluxo normal."/>
    <CustomerRequestsQueue/>

    <SectionHeader title="Envios em andamento" description="Operação atual — cada etiqueta pode reunir várias compras do mesmo cliente."/>
    <OperationalShipments key={requestedTask??'all'} initialTask={requestedTask&&['quote','approval','conference','label','post','data'].includes(requestedTask)?requestedTask:undefined}/>

    {summary&&<section className="coverage card"><div><span>Envios identificados</span><strong>{integer(summary.identified_shipments)}</strong></div><div><span>Enviados no período</span><strong>{integer(summary.shipped_in_period)}</strong></div><div><span>Média até envio</span><strong>{summary.average_days_to_ship==null?'—':`${summary.average_days_to_ship} dias`}</strong></div><div><span>Backlog operacional</span><strong>{integer(summary.operational_backlog)}</strong></div><div><span>Dentro do prazo real</span><strong>{integer(summary.historical_on_time)}</strong></div><div><span>Atrasados com prazo real</span><strong>{integer(summary.historical_late)}</strong></div></section>}

    <Divider label="Histórico logístico"/>
    <SectionHeader title="STATUS HISTÓRICO" description="Classificação manual do legado, separada do status operacional de shipment."/>
    <section className="legacy-confirmation-summary" aria-label="Contadores de status histórico"><div><span>CONFIRMADOS</span><strong>{integer(legacyCounts.confirmed)}</strong></div><div><span>A ENVIAR</span><strong>{integer(legacyCounts.to_send)}</strong></div><div><span>SEM ESTOQUE</span><strong>{integer(legacyCounts.out_of_stock)}</strong></div><div><span>SEM CLASSIFICAÇÃO</span><strong>{integer(legacyCounts.unclassified)}</strong></div></section>
    <div className="legacy-confirmation-filters" aria-label="Filtrar status histórico">
      {([['all','TODOS'],['confirmed','CONFIRMADO'],['to_send','A ENVIAR'],['out_of_stock','SEM ESTOQUE']] as const).map(([key,label])=><button key={key} className={legacyStatusFilter===key?'active':''} onClick={()=>setLegacyStatusFilter(key)}>{label}</button>)}
    </div>
    <section className="metrics">{[['awaiting_shipment','Aguardando envio'],['overdue','Envio atrasado'],['shipped_on_time','Enviados no prazo'],['shipped_late','Enviados com atraso'],['shipped','Enviados'],['no_deadline','Sem prazo']].map(([key,label])=><Metric key={key} label={label} value={integer(counts[key]??0)} detail={period.label} icon={Truck}/>)}</section>

    <div className="deliveries-toolbar">
      <SearchInput value={search} onChange={setSearch} placeholder="Cliente ou perfume…"/>
      <SecondaryButton icon={<Filter size={16}/>} onClick={()=>setFiltersOpen(true)}>{filter?`Filtro: ${deliveryLabels[filter]}`:'Filtros'}</SecondaryButton>
    </div>
    <Drawer open={filtersOpen} onClose={()=>setFiltersOpen(false)} side="right" aria-label="Filtrar entregas por status">
      <div className="deliveries-filters-drawer">
        <h3>Filtrar por status</h3>
        <button className={filter===''?'active':''} onClick={()=>{setFilter('');setFiltersOpen(false)}}>Todos os status</button>
        {Object.entries(deliveryLabels).map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>{setFilter(key);setFiltersOpen(false)}}>{label}</button>)}
      </div>
    </Drawer>

    {loading?<div className="empty card"><h3>Carregando entregas…</h3></div>:<>{error&&<div className="notice"><AlertTriangle/><span>{error}</span></div>}<div className="card clients-table"><div className="clients-caption"><strong>{integer(visible.length)} registros históricos</strong><span className="live-dot">SUPABASE</span></div>
      <Table
        rowKey={(row)=>row.id}
        rows={visible.slice(0,500)}
        columns={[
          {key:'client',label:'Cliente',render:(row)=><strong>{row.clients?.name??row.original_client}</strong>},
          {key:'perfume_name_raw',label:'Perfume',render:(row)=>row.perfume_name_raw},
          {key:'sale_date',label:'Venda',render:(row)=>row.sale_date?shortDate(row.sale_date):'—'},
          {key:'shipped_at',label:'Envio',render:(row)=>row.shipped_at?shortDate(row.shipped_at):'—'},
          {key:'status',label:'Status histórico',render:(row)=><LegacyShippingStatusInput key={`${row.id}:${row.updated_at}`} saleId={row.id} status={row.legacy_shipping_status} updatedAt={row.updated_at} onSaved={applyLegacyStatus}/>},
          {key:'amount',label:'Valor',render:(row)=>brl(Number(row.amount))},
          {key:'actions',label:'Ações',render:(row)=><button onClick={()=>{setHistorical(row);setHistoricalDate(row.shipped_at?.slice(0,10)||todayIso())}}>{row.shipped_at?'Editar envio histórico':'Registrar envio histórico'}</button>},
        ]}
      />
    </div></>}
  </div>
}
