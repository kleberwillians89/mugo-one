import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { BarcodeImage } from '../components/bottles/BarcodeImage'
import { QrCodeImage } from '../components/bottles/QrCodeImage'
import { brl, shortDate } from '../lib/format'
import { fetchShipment360, OperationalShipment } from '../lib/records'
import { operationalLabel } from '../lib/presentation'
import { shipmentControlDeepLink } from '../lib/shipment-queue'
import './ShipmentPrintPage.css'

const PAGE_STYLE='@page { size: A4; margin: 12mm; }'
const saleType=(value:string|null|undefined)=>value==='SPLIT'?'Fracionado':value==='APC'?'Perfume compartilhado':'Perfume'

export function ShipmentPrintPage(){
  const shipmentId=new URLSearchParams(location.search).get('id')??''
  const validShipmentId=/^[0-9a-f-]{36}$/i.test(shipmentId)
  const [shipment,setShipment]=useState<OperationalShipment|null>(null),[error,setError]=useState('')
  useEffect(()=>{if(!validShipmentId)return;fetchShipment360(shipmentId).then(setShipment).catch(()=>setError('Não foi possível carregar este documento.'))},[shipmentId,validShipmentId])
  const items=useMemo(()=>[...(shipment?.shipment_items??[])].sort((a,b)=>String(a.sales?.perfume_name_raw??'').localeCompare(String(b.sales?.perfume_name_raw??''),'pt-BR')),[shipment])
  if(!validShipmentId||error)return <main className="shipment-document-state"><p>{error||'Documento não encontrado.'}</p><button onClick={()=>history.back()}>Voltar</button></main>
  if(!shipment)return <main className="shipment-document-state"><p>Preparando documento…</p></main>
  const subtotal=items.reduce((sum,item)=>sum+Number(item.sales?.amount??0),0)
  const totalMl=items.reduce((sum,item)=>sum+Number(item.quantity_ml),0)
  const freight=shipment.shipping_price==null?null:Number(shipment.shipping_price)
  const address=[shipment.recipient_address,shipment.recipient_number,shipment.recipient_complement,shipment.recipient_district,shipment.recipient_city,shipment.recipient_state,shipment.recipient_postal_code].filter(Boolean).join(' · ')
  return <main className="shipment-document-page"><style>{PAGE_STYLE}</style><nav className="shipment-document-actions"><button onClick={()=>history.back()}><ArrowLeft/> VOLTAR</button><button onClick={()=>window.print()}><Printer/> IMPRIMIR</button></nav><article className="shipment-document">
    <header className="shipment-document-header"><div><strong>RUAH</strong><span>PARFUMS</span></div><div><span>DOCUMENTO OPERACIONAL</span><h1>Folha do envio</h1><dl><div><dt>Data</dt><dd>{shortDate(shipment.created_at)}</dd></div><div><dt>Status</dt><dd>{operationalLabel(shipment.status)}</dd></div>{shipment.tracking_code&&<div><dt>Rastreio</dt><dd>{shipment.tracking_code}</dd></div>}</dl></div></header>
    <section className="shipment-document-client"><h2>Cliente</h2><strong>{shipment.recipient_name}</strong>{shipment.recipient_phone&&<span>{shipment.recipient_phone}</span>}{address&&<p>{address}</p>}</section>
    <section className="shipment-document-items"><h2>Itens</h2><table><thead><tr><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th></tr></thead><tbody>{items.map(item=><tr key={item.allocation_id}><td>{item.sales?.perfume_name_raw||'Perfume'}</td><td>{saleType(item.sales?.sale_type)}</td><td>{Number(item.quantity_ml).toLocaleString('pt-BR')} ml</td><td>{item.sales?.amount==null?'—':brl(Number(item.sales.amount))}</td></tr>)}</tbody></table></section>
    <section className="shipment-document-bottom"><div className="shipment-document-control"><QrCodeImage value={shipmentControlDeepLink(shipment.id)} size={104} alt="QR do envio"/><div><BarcodeImage value={shipment.id} displayValue={false} height={34} width={1} margin={2}/><span>Bipe para abrir este envio no CRM</span></div></div><dl className="shipment-document-totals"><div><dt>Perfumes</dt><dd>{items.length}</dd></div><div><dt>Total em ml</dt><dd>{totalMl.toLocaleString('pt-BR')} ml</dd></div>{subtotal>0&&<div><dt>Subtotal</dt><dd>{brl(subtotal)}</dd></div>}{freight!=null&&<div><dt>Frete</dt><dd>{brl(freight)}</dd></div>}{subtotal>0&&<div className="total"><dt>Total</dt><dd>{brl(subtotal+(freight??0))}</dd></div>}</dl></section>
    <footer><span>RUAH Parfums</span><small>Documento operacional para separação e conferência. Não é documento fiscal.</small></footer>
  </article></main>
}
