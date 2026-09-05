import { useEffect, useState } from 'react'
import { AlertTriangle, Filter, Plus, Truck } from 'lucide-react'
import { brl, integer, shortDate } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { todayIso, deliveryState, deliveryLabels, deliveryLabel } from '../lib/delivery'
import { NewShipmentModal, OperationalShipments } from '../components/ShipmentOperations'
import { CustomerRequestsQueue } from '../components/CustomerRequestsQueue'
import {
  CommercialSale, LogisticsSummary, fetchDeliveryRows, fetchLogisticsSummary, setLegacyShippingConfirmation, updateShipment,
} from '../lib/records'
import { countLegacyShipping, formatLegacyShippingInput, legacyShippingLabels, legacyShippingState, parseLegacyShippingInput, type LegacyShippingConfirmation } from '../lib/legacy-shipping'
import { useHasPermission } from '../lib/PermissionsContext'
import { Metric } from '../components/shared/Metric'
import { Divider, Drawer, Modal, PageHeader, PrimaryButton, SearchInput, SecondaryButton, SectionHeader, Table, useToast } from '../components/ui'
import './DeliveriesPage.css'

export function DeliveriesPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const toast=useToast(),canEdit=useHasPermission('sales.edit')
  const [rows,setRows]=useState<CommercialSale[]>([]),[filter,setFilter]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [confirmationFilter,setConfirmationFilter]=useState<'all'|LegacyShippingConfirmation>('pending'),[savingConfirmation,setSavingConfirmation]=useState<string|null>(null),[notSentSale,setNotSentSale]=useState<CommercialSale|null>(null),[confirmationDrafts,setConfirmationDrafts]=useState<Record<string,string>>({})
  const [newShipment,setNewShipment]=useState(false),[historical,setHistorical]=useState<CommercialSale|null>(null),[historicalDate,setHistoricalDate]=useState(todayIso())
  const [summary,setSummary]=useState<LogisticsSummary|null>(null)
  const [filtersOpen,setFiltersOpen]=useState(false)
  const reload=()=>{Promise.all([fetchDeliveryRows(period),fetchLogisticsSummary(period)]).then(([sales,metrics])=>{setRows(sales);setSummary(metrics)}).catch(()=>setError('Não foi possível consultar as entregas.')).finally(()=>setLoading(false))}
  useEffect(reload,[period])
  const counts=rows.reduce((acc,row)=>{const key=deliveryState(row);acc[key]=(acc[key]??0)+1;return acc},{} as Record<string,number>),confirmationCounts=countLegacyShipping(rows)
  const visible=rows.filter((row)=>(confirmationFilter==='all'||legacyShippingState(row.legacy_shipping_confirmation)===confirmationFilter)&&(!filter||deliveryState(row)===filter)&&(!search||`${row.original_client} ${row.perfume_name_raw}`.toLowerCase().includes(search.toLowerCase())))
  const register=async(row:CommercialSale,value:string|null)=>{try{await updateShipment(row.id,value);setHistorical(null);reload()}catch(err){setError(err instanceof Error?err.message:'Falha ao atualizar envio.')}}
  const resetDraft=(saleId:string)=>setConfirmationDrafts(current=>{const next={...current};delete next[saleId];return next})
  const saveConfirmation=async(row:CommercialSale,confirmation:LegacyShippingConfirmation,shippingDate:string|null)=>{setSavingConfirmation(row.id);setError('');try{const result=await setLegacyShippingConfirmation(row.id,confirmation,shippingDate,row.updated_at);setRows(current=>current.map(item=>item.id===row.id?{...item,legacy_shipping_confirmation:result.confirmation==='pending'?null:result.confirmation,legacy_shipping_date:result.shipping_date,legacy_shipping_confirmed_at:result.confirmed_at,legacy_shipping_confirmed_by:result.confirmed_by,updated_at:result.updated_at}:item));resetDraft(row.id);toast.push(confirmation==='sent'?'Envio confirmado.':confirmation==='not_sent'?'Venda confirmada como não enviada.':'Confirmação voltou para A confirmar.',{tone:'success'})}catch(reason){const message=reason instanceof Error?reason.message:'Não foi possível salvar a confirmação.';setError(message);toast.push(message,{tone:'error'});reload()}finally{setSavingConfirmation(null);setNotSentSale(null)}}
  const commitInput=(row:CommercialSale,value:string)=>{if(savingConfirmation===row.id)return;let parsed;try{parsed=parseLegacyShippingInput(value)}catch(reason){const message=reason instanceof Error?reason.message:'Valor inválido.';setError(message);toast.push(message,{tone:'error'});return}const currentState=legacyShippingState(row.legacy_shipping_confirmation),currentDate=row.legacy_shipping_date??null;if(parsed.confirmation===currentState&&parsed.shippingDate===currentDate){resetDraft(row.id);return}if(parsed.confirmation==='not_sent'){setNotSentSale(row);return}void saveConfirmation(row,parsed.confirmation,parsed.shippingDate)}
  const cancelNotSent=()=>{if(notSentSale)resetDraft(notSentSale.id);setNotSentSale(null)}

  return <div className="page">
    {newShipment&&<NewShipmentModal close={()=>setNewShipment(false)}/>}
    <Modal open={Boolean(notSentSale)} onClose={cancelNotSent} eyebrow="CONFERÊNCIA MANUAL" title="Confirmar como não enviado?">
      <div className="record-form"><p>Esta ação não cancela a venda nem altera estoque ou pagamento.<br/>Ela serve somente para conferência histórica.</p><div className="form-actions"><SecondaryButton onClick={cancelNotSent}>CANCELAR</SecondaryButton><PrimaryButton loading={Boolean(notSentSale&&savingConfirmation===notSentSale.id)} onClick={()=>notSentSale&&void saveConfirmation(notSentSale,'not_sent',null)}>CONFIRMAR</PrimaryButton></div></div>
    </Modal>
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

    <SectionHeader title="Solicitações de clientes" description="Pedidos de envio feitos pela cliente no Minha RUAH — cote o frete para continuar pelo fluxo normal."/>
    <CustomerRequestsQueue/>

    <SectionHeader title="Envios em andamento" description="Operação atual — cada etiqueta pode reunir várias compras do mesmo cliente."/>
    <OperationalShipments/>

    {summary&&<section className="coverage card"><div><span>Envios identificados</span><strong>{integer(summary.identified_shipments)}</strong></div><div><span>Enviados no período</span><strong>{integer(summary.shipped_in_period)}</strong></div><div><span>Média até envio</span><strong>{summary.average_days_to_ship==null?'—':`${summary.average_days_to_ship} dias`}</strong></div><div><span>Backlog operacional</span><strong>{integer(summary.operational_backlog)}</strong></div><div><span>Dentro do prazo real</span><strong>{integer(summary.historical_on_time)}</strong></div><div><span>Atrasados com prazo real</span><strong>{integer(summary.historical_late)}</strong></div></section>}

    <Divider label="Histórico logístico"/>
    <SectionHeader title="CONFERÊNCIA MANUAL" description="Controle histórico separado do status operacional de shipment."/>
    <section className="legacy-confirmation-summary" aria-label="Contadores de conferência manual"><div><span>A CONFIRMAR</span><strong>{integer(confirmationCounts.pending)}</strong></div><div><span>ENVIADOS</span><strong>{integer(confirmationCounts.sent)}</strong></div><div><span>NÃO ENVIADOS</span><strong>{integer(confirmationCounts.not_sent)}</strong></div></section>
    <div className="legacy-confirmation-filters" aria-label="Filtrar confirmação manual">
      {([['all','TODOS'],['pending','A CONFIRMAR'],['sent','ENVIADO'],['not_sent','NÃO ENVIADO']] as const).map(([key,label])=><button key={key} className={confirmationFilter===key?'active':''} onClick={()=>setConfirmationFilter(key)}>{label}</button>)}
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
          {key:'status',label:'Status',render:(row)=><span className={`badge ${deliveryState(row)==='overdue'?'cancelled':'pending'}`}>{deliveryLabel(row)}</span>},
          {key:'confirmation',label:'Entrega',render:(row)=>{const state=legacyShippingState(row.legacy_shipping_confirmation),saving=savingConfirmation===row.id,value=confirmationDrafts[row.id]??formatLegacyShippingInput(row.legacy_shipping_confirmation,row.legacy_shipping_date);return <div className="legacy-delivery-control"><input className="legacy-delivery-input" aria-label={`Entrega legada de ${row.clients?.name??row.original_client??'venda'}`} value={value} placeholder="DD/MM/AAAA ou X" disabled={!canEdit||saving} onChange={event=>setConfirmationDrafts(current=>({...current,[row.id]:event.target.value}))} onBlur={event=>commitInput(row,event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/><span className={`legacy-delivery-badge legacy-delivery-badge--${state}`}>{saving?'SALVANDO...':legacyShippingLabels[state]}</span></div>}},
          {key:'amount',label:'Valor',render:(row)=>brl(Number(row.amount))},
          {key:'actions',label:'Ações',render:(row)=><button onClick={()=>{setHistorical(row);setHistoricalDate(row.shipped_at?.slice(0,10)||todayIso())}}>{row.shipped_at?'Editar envio histórico':'Registrar envio histórico'}</button>},
        ]}
      />
    </div></>}
  </div>
}
