import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { brl, dateTime, shortDate } from '../lib/format'
import { operationalLabel, statusLabel } from '../lib/presentation'
import { deliveryLabel } from '../lib/delivery'
import { LegacyShippingStatusInput } from '../components/LegacyShippingStatusInput'
import {
  CommercialSale, type LegacyShippingStatusResult, confirmLegacyProductCustody, confirmSaleShippingAvailability, createDraftShipment, fetchSale360, releaseLegacyProductCustody,
} from '../lib/records'
import { SaleActivity, SaleItemLine, fetchSaleActivities, fetchSaleItems, legacySaleItemLine } from '../lib/sale-items'
import { missingShippingClientFields } from '../lib/client-completeness'
import { useHasFeature } from '../lib/PermissionsContext'
import { Alert, DefinitionGroup, Divider, Modal, PrimaryButton, SecondaryButton, Table } from '../components/ui'
import { EntityTasksBlock } from '../components/EntityTasksBlock'
import './SaleDetailsPage.css'

const money = (value: number) => brl(value)

/**
 * Venda 360 universal (Fase F, ver docs/SALES_CATALOG_MIGRATION_PLAN.md
 * §18-22). Itens/Pagamento/Atividades sempre aparecem — Custódia e
 * Estoque e Logística só aparecem quando a organização tem os
 * respectivos features habilitados E a venda tem contexto para eles
 * (allocation/shipment reais). Uma consultoria com `shipping`/
 * `inventory` desabilitados nunca vê "Envio"/"Estoque" aqui.
 */
export function SaleDetailsPage({saleId}:{saleId:string}){
  const [sale,setSale]=useState<CommercialSale|null>(null),[loadError,setLoadError]=useState(''),[operationError,setOperationError]=useState(''),[preparing,setPreparing]=useState(false),[confirming,setConfirming]=useState(false),[confirmed,setConfirmed]=useState(false),[location,setLocation]=useState(''),[saving,setSaving]=useState(false)
  const [verificationNote,setVerificationNote]=useState('Produto conferido manualmente para envio.')
  const [items,setItems]=useState<SaleItemLine[]>([])
  const [activities,setActivities]=useState<SaleActivity[]>([])
  const hasShippingFeature=useHasFeature('shipping')
  const hasInventoryFeature=useHasFeature('inventory')
  const reload=()=>fetchSale360(saleId).then(setSale).catch(()=>setOperationError('A operação foi concluída, mas não foi possível atualizar os dados da venda.'))
  useEffect(()=>{fetchSale360(saleId).then(setSale).catch(()=>setLoadError('Venda não encontrada.'))},[saleId])
  useEffect(()=>{
    fetchSaleItems(saleId).then((rows)=>{if(rows.length)setItems(rows)}).catch(()=>{})
    fetchSaleActivities(saleId).then(setActivities).catch(()=>{})
  },[saleId])
  if(loadError)return <div className="page"><div className="notice"><AlertTriangle/><span>{loadError}</span></div></div>
  if(!sale)return <div className="page"><div className="empty card"><h3>Carregando Venda 360…</h3></div></div>
  const displayItems=items.length?items:[legacySaleItemLine({perfume_name_raw:sale.perfume_name_raw,volume_ml:sale.volume_ml,amount:sale.amount})]
  const allocation=sale.inventory_allocations?.find(item=>['reserved','shipping','shipped'].includes(item.status)),shipment=sale.shipment_items?.[0]?.shipments
  const missingFields=sale.clients?missingShippingClientFields(sale.clients):[]
  const goToClient=()=>{if(!sale.client_id)return;history.pushState({},'',`/clientes/${sale.client_id}`);dispatchEvent(new PopStateEvent('popstate'))}
  const prepare=async()=>{if(!sale.client_id||!allocation||missingFields.length>0)return;setPreparing(true);setOperationError('');try{const id=await createDraftShipment(sale.client_id,[allocation.id]);history.pushState({},'',`/entregas/${id}`);dispatchEvent(new PopStateEvent('popstate'))}catch(reason){setOperationError(reason instanceof Error?reason.message:'Não foi possível preparar o envio.')}finally{setPreparing(false)}}
  const confirmCustody=async()=>{if(!confirmed)return;setSaving(true);setOperationError('');try{await confirmLegacyProductCustody(sale.id,location,verificationNote);setConfirming(false);setConfirmed(false);await reload()}catch{setOperationError('Não foi possível confirmar a custódia. Nenhuma alteração foi realizada. Tente novamente.')}finally{setSaving(false)}}
  const release=async()=>{if(!allocation)return;setSaving(true);try{await releaseLegacyProductCustody(allocation.id);await reload()}catch(reason){setOperationError(reason instanceof Error?reason.message:'Não foi possível remover a confirmação.')}finally{setSaving(false)}}
  const confirmAvailability=async()=>{setSaving(true);setOperationError('');try{await confirmSaleShippingAvailability(sale.id);await reload()}catch(reason){setOperationError(reason instanceof Error?reason.message:'Não foi possível confirmar a disponibilidade.')}finally{setSaving(false)}}
  const applyLegacyStatus=(result:LegacyShippingStatusResult)=>setSale(current=>current?{...current,legacy_shipping_status:result.status,legacy_shipping_status_updated_at:result.status_updated_at,legacy_shipping_status_updated_by:result.status_updated_by,updated_at:result.updated_at}:current)
  const canConfirm=hasShippingFeature&&!allocation&&!shipment&&!sale.shipped_at&&Boolean(sale.client_id&&sale.perfume_id&&sale.volume_ml&&sale.volume_ml>0)
  const clientName=sale.clients?.name??sale.original_client??'Venda'
  const itemsSubtitle=items.length>1?`${items.length} itens`:displayItems[0]?.description??'Item não informado'

  return <div className="page sale-360 sale-ficha">
    <Modal open={confirming} onClose={()=>setConfirming(false)} eyebrow="CONFIRMAÇÃO HUMANA" title="Confirmar produto em custódia">
      <DefinitionGroup title="Resumo" items={[
        {label:'Cliente',value:sale.clients?.name||sale.original_client||'—'},
        {label:'Item',value:itemsSubtitle},
        {label:'Venda',value:money(Number(sale.amount))},
      ]}/>
      <Divider/>
      <strong className="confirm-question">Você conferiu fisicamente este produto?</strong>
      <label className="confirm-checkbox">
        <input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
        <span>Confirmei que este produto está fisicamente com a organização e pertence a este cliente.</span>
      </label>
      <label className="field"><span>Caixa / localização</span><input value={location} onChange={event=>setLocation(event.target.value)} placeholder="Ex.: Caixa 2, Prateleira B"/></label>
      <label className="field"><span>Observação</span><textarea value={verificationNote} onChange={event=>setVerificationNote(event.target.value)}/></label>
      <div className="notice"><span>Esta confirmação não altera o estoque operacional.</span></div>
      <div className="form-actions">
        <SecondaryButton onClick={()=>setConfirming(false)}>Cancelar</SecondaryButton>
        <PrimaryButton disabled={!confirmed} loading={saving} onClick={confirmCustody}>Confirmar produto</PrimaryButton>
      </div>
    </Modal>

    <button className="back-link" onClick={()=>history.back()}>← Voltar para vendas</button>

    <header className="ficha-head surface-dark">
      <span className="ficha-eyebrow">VENDA</span>
      <h1 className="ficha-client" data-surface-role="primary">{clientName}</h1>
      <p className="ficha-product" data-surface-role="secondary">{itemsSubtitle}</p>
      <div className="ficha-price-row">
        <strong data-surface-role="metric">{money(Number(sale.amount))}</strong>
        <span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]||sale.payment_status}</span>
      </div>
      <div className="ficha-actions">
        {sale.client_id&&<SecondaryButton onClick={goToClient}>Ver cliente</SecondaryButton>}
        {canConfirm&&<PrimaryButton onClick={()=>setConfirming(true)}>Confirmar produto</PrimaryButton>}
        {hasShippingFeature&&allocation?.status==='reserved'&&<PrimaryButton disabled={missingFields.length>0} loading={preparing} onClick={prepare}>Preparar envio</PrimaryButton>}
        {hasShippingFeature&&shipment&&<a className="ui-btn ui-btn--primary button-link" href={`/entregas/${shipment.id}`}>Abrir envio</a>}
      </div>
    </header>

    {operationError&&<div className="notice"><AlertTriangle/><span>{operationError}</span></div>}

    <Divider label="Cliente"/>
    <DefinitionGroup title="Contato" items={[
      {label:'Nome',value:sale.clients?.name||'—'},
      {label:'Telefone',value:sale.clients?.phone||sale.clients?.whatsapp_phone||'—'},
      {label:'E-mail',value:sale.clients?.email||'—'},
      {label:'Documento',value:sale.clients?.cpf||sale.clients?.cnpj||'—'},
      {label:'Endereço',value:[sale.clients?.address_line,sale.clients?.address_number,sale.clients?.city,sale.clients?.state].filter(Boolean).join(', ')||'—'},
    ]}/>
    {hasShippingFeature&&missingFields.length>0&&<Alert tone="warning" title="DADOS DE ENVIO INCOMPLETOS">
      Faltam: {missingFields.join(' · ')}. <SecondaryButton onClick={goToClient}>Completar cadastro do cliente</SecondaryButton>
    </Alert>}

    <Divider label="Itens"/>
    <div className="card clients-table">
      <Table rowKey={(item)=>item.id??`legacy:${item.description}`} rows={displayItems} columns={[
        {key:'description',label:'Produto/Serviço',render:(item)=><strong>{item.description}</strong>},
        {key:'quantity',label:'Quantidade',render:(item)=>item.quantity.toLocaleString('pt-BR')},
        {key:'unit',label:'Unidade',render:(item)=>item.unit},
        {key:'unit_price',label:'Valor unitário',render:(item)=>money(item.unitPrice)},
        {key:'total',label:'Total',render:(item)=>money(item.totalAmount)},
      ]}/>
    </div>

    <Divider label="Pagamento"/>
    <DefinitionGroup title="Pagamento" items={[
      {label:'Valor',value:money(Number(sale.amount))},
      {label:'Status',value:statusLabel[sale.payment_status]||sale.payment_status},
      {label:'Crédito',value:money(Number(sale.credit_reference_amount||0))},
      {label:'Forma',value:sale.payment_method||'Não informada'},
      {label:'Data',value:sale.paid_at?shortDate(sale.paid_at):'Sem baixa'},
    ]}/>
    <DefinitionGroup title="Origem" items={[
      {label:'Origem',value:sale.source==='spreadsheet'?'Importação':'Manual'},
      {label:'Observações',value:sale.notes||'—'},
    ]}/>

    <Divider label="Tarefas"/>
    <EntityTasksBlock entityType="sale" entityId={sale.id} entityLabel={clientName}/>

    {hasInventoryFeature&&<>
      <Divider label="Custódia e estoque"/>
      {sale.shipping_availability_kind&&<DefinitionGroup title="Disponibilidade para envio" items={[
        {label:'Texto da origem',value:sale.shipping_availability_text||'—'},
        {label:'Interpretação',value:({available_now:'Disponível agora',available_from_date:'Disponível a partir da data',expected_by_date:'Previsão até a data',lead_time:'Prazo em dias úteis',unknown:'Precisa revisar'} as Record<string,string>)[sale.shipping_availability_kind]||sale.shipping_availability_kind},
        {label:'Data prevista',value:sale.shipping_available_date?shortDate(sale.shipping_available_date):'—'},
        {label:'Confirmação operacional',value:sale.shipping_availability_confirmed_at?`Confirmada em ${shortDate(sale.shipping_availability_confirmed_at)}`:'Aguardando confirmação física'},
      ]} action={!sale.shipping_availability_confirmed_at?<PrimaryButton loading={saving} onClick={confirmAvailability}>Confirmar chegada</PrimaryButton>:undefined}/>}
      <DefinitionGroup title="Estoque" items={[
        {label:'Reserva de estoque',value:allocation?.status?operationalLabel(allocation.status):'Nenhuma operação de estoque vinculada'},
        {label:'Origem',value:allocation?.stock_managed?'Estoque operacional':allocation?'Conferido manualmente':'—'},
        {label:'Quantidade',value:allocation?`${Number(allocation.quantity_ml).toLocaleString('pt-BR')} ml`:'—'},
        {label:'Confirmado em',value:allocation?.verified_at?shortDate(allocation.verified_at):'—'},
        {label:'Localização',value:allocation?.storage_location||'—'},
      ]} action={allocation?.allocation_source==='legacy_manual_verified'&&allocation.status==='reserved'&&!allocation.shipment_id?<SecondaryButton loading={saving} onClick={release}>Remover confirmação</SecondaryButton>:undefined}/>
    </>}

    {hasShippingFeature&&<>
      <Divider label="Logística"/>
      <DefinitionGroup title="Envio" items={[
        {label:'Envio',value:shipment?.id||'Ainda não preparado'},
        {label:'Status operacional',value:shipment?.status?operationalLabel(shipment.status):deliveryLabel(sale)},
        {label:'Status histórico',value:<LegacyShippingStatusInput key={`${sale.id}:${sale.updated_at}`} saleId={sale.id} status={sale.legacy_shipping_status} updatedAt={sale.updated_at} onSaved={applyLegacyStatus}/>},
        {label:'Transportadora',value:shipment?.carrier?`${shipment.carrier} · ${shipment.service||''}`:'—'},
        {label:'Rastreio',value:shipment?.tracking_code||'—'},
        {label:'Prazo histórico',value:sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'},
        {label:'Envio histórico',value:sale.shipped_at?shortDate(sale.shipped_at):'—'},
      ]}/>
    </>}

    {activities.length>0&&<>
      <Divider label="Atividades"/>
      <div className="sale-activity-timeline">
        {activities.map((activity)=><article key={activity.id}><strong>{activity.title}</strong>{activity.description&&<p>{activity.description}</p>}<time>{dateTime(activity.createdAt)}</time></article>)}
      </div>
    </>}
  </div>
}
