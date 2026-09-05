import {useMemo,useState} from 'react'
import {shortDate} from '../lib/format'
import {legacyShippingLabels,legacyShippingState,type LegacyShippingConfirmation} from '../lib/legacy-shipping'
import {legacyShippingStatusLabel} from '../lib/legacy-shipping-status'
import {createDraftShipment,type WaitingProduct} from '../lib/records'
import {operationalLabel} from '../lib/presentation'
import {Alert,PrimaryButton} from './ui'
import './ShipmentProductSelector.css'

type LinkedShipment={id:string;status:string;posted_at?:string|null;delivered_at?:string|null}
export type ShipmentSelectionSale={id:string;sale_date:string|null;perfume_name_raw:string|null;bottle_identifier?:string|null;legacy_shipping_status?:string|null;legacy_shipping_confirmation?:string|null;legacy_shipping_date?:string|null;shipped_at?:string|null;shipment_items?:Array<{removed_at?:string|null;shipment_id:string;shipments?:LinkedShipment|LinkedShipment[]|null}>}
type Filter='eligible'|'all'|LegacyShippingConfirmation
type Props={clientId:string;sales:ShipmentSelectionSale[];waiting:WaitingProduct[];disabled?:boolean;onCreated:(shipmentId:string)=>void}

export function ShipmentProductSelector({clientId,sales,waiting,disabled,onCreated}:Props){
  const [filter,setFilter]=useState<Filter>('eligible'),[selected,setSelected]=useState<string[]>([]),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const allocationBySale=useMemo(()=>new Map(waiting.map(item=>[item.sale_id,item])),[waiting])
  const rows=useMemo(()=>sales.map(sale=>{const shipmentItem=sale.shipment_items?.find(item=>{const shipment=Array.isArray(item.shipments)?item.shipments[0]:item.shipments;return!item.removed_at&&shipment?.status!=='cancelled'}),shipment=shipmentItem?(Array.isArray(shipmentItem.shipments)?shipmentItem.shipments[0]??null:shipmentItem.shipments??null):null,allocation=allocationBySale.get(sale.id);return{sale,allocation,shipment,eligible:Boolean(allocation&&!shipment)}}),[sales,allocationBySale])
  const visible=rows.filter(row=>filter==='all'||(filter==='eligible'?row.eligible:legacyShippingState(row.sale.legacy_shipping_confirmation)===filter))
  const toggle=(allocationId:string)=>setSelected(current=>current.includes(allocationId)?current.filter(id=>id!==allocationId):[...current,allocationId])
  const submit=async()=>{if(!selected.length||saving)return;setSaving(true);setError('');try{const shipmentId=await createDraftShipment(clientId,selected);onCreated(shipmentId)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar o envio.')}finally{setSaving(false)}}
  return <div className="shipment-product-selector">
    <div className="shipment-product-filters" aria-label="Filtrar produtos do frete">{([['eligible','PENDENTES'],['all','TODOS'],['sent','ENVIADOS'],['not_sent','NÃO ENVIADOS'],['pending','A CONFIRMAR']] as const).map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <div className="shipment-product-table"><table><thead><tr><th></th><th>Compra</th><th>Perfume</th><th>Frasco</th><th>Status histórico</th><th>Confirmação manual</th><th>Shipment atual</th><th>Data de envio</th><th>Status operacional</th></tr></thead><tbody>{visible.map(({sale,allocation,shipment,eligible})=><tr key={sale.id} className={!eligible?'is-disabled':''}><td><input type="checkbox" aria-label={`Selecionar ${sale.perfume_name_raw??'produto'}`} disabled={!eligible||disabled} checked={Boolean(allocation&&selected.includes(allocation.allocation_id))} onChange={()=>allocation&&toggle(allocation.allocation_id)}/></td><td>{sale.sale_date?shortDate(sale.sale_date):'—'}</td><td><strong>{sale.perfume_name_raw||'—'}</strong></td><td>{sale.bottle_identifier||'—'}</td><td>{legacyShippingStatusLabel(sale.legacy_shipping_status)}</td><td>{legacyShippingLabels[legacyShippingState(sale.legacy_shipping_confirmation)]}</td><td>{shipment?<><a href={`/entregas/${shipment.id}`}>#{shipment.id.slice(0,8).toUpperCase()}</a><small>Este item já possui envio registrado.</small></>:'—'}</td><td>{sale.legacy_shipping_date?shortDate(sale.legacy_shipping_date):sale.shipped_at?shortDate(sale.shipped_at):shipment?.posted_at?shortDate(shipment.posted_at):'—'}</td><td>{shipment?operationalLabel(shipment.status):allocation?'Pronto para novo frete':'Sem allocation reservada'}</td></tr>)}</tbody></table></div>
    {!visible.length&&<div className="inline-empty">Nenhuma compra neste filtro.</div>}
    <div className="notice"><span>Todas as compras são exibidas. Itens sem allocation reservada ou já vinculados a um shipment ficam bloqueados; reenvio ainda não é uma operação disponível.</span></div>
    {error&&<Alert tone="danger" title="NÃO FOI POSSÍVEL CRIAR O FRETE">{error}</Alert>}
    <PrimaryButton disabled={!selected.length||saving||disabled} loading={saving} onClick={submit}>{selected.length?`Criar frete com ${selected.length} ${selected.length===1?'produto':'produtos'}`:'Selecione os produtos'}</PrimaryButton>
  </div>
}
