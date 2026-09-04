import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { brl, shortDate } from '../lib/format'
import { fetchShipment360, OperationalShipment } from '../lib/records'
import { operationalLabel } from '../lib/presentation'
import './ShipmentPrintPage.css'

const PAGE_STYLE='@page { size: A4 portrait; margin: 12mm 14mm; }'
type PrintableShipment=OperationalShipment&{notes?:string|null;requested_at?:string|null}
const humanReference=(id:string)=>`ENVIO ${id.slice(0,8).toUpperCase()}`

export function ShipmentPrintPage(){
  const shipmentId=new URLSearchParams(location.search).get('id')??''
  const validShipmentId=/^[0-9a-f-]{36}$/i.test(shipmentId)
  const [shipment,setShipment]=useState<PrintableShipment|null>(null),[error,setError]=useState('')
  useEffect(()=>{if(!validShipmentId)return;fetchShipment360(shipmentId).then(setShipment).catch(()=>setError('Não foi possível carregar esta nota de envio.'))},[shipmentId,validShipmentId])
  const items=useMemo(()=>[...(shipment?.shipment_items??[])].sort((a,b)=>String(a.sales?.perfume_name_raw??'').localeCompare(String(b.sales?.perfume_name_raw??''),'pt-BR')),[shipment])
  if(!validShipmentId||error)return <main className="shipment-document-state"><p>{error||'Nota de envio não encontrada.'}</p><button onClick={()=>history.back()}>Voltar</button></main>
  if(!shipment)return <main className="shipment-document-state"><p>Preparando nota de envio…</p></main>
  const totalMl=items.reduce((sum,item)=>sum+Number(item.quantity_ml),0)
  const freight=shipment.shipping_price==null?null:Number(shipment.shipping_price)
  const addressLine=[shipment.recipient_address,shipment.recipient_number,shipment.recipient_complement].filter(Boolean).join(', ')
  const localityLine=shipment.recipient_city&&shipment.recipient_state?`${shipment.recipient_city} / ${shipment.recipient_state}`:shipment.recipient_city||shipment.recipient_state
  return <main className="shipment-document-page"><style>{PAGE_STYLE}</style><nav className="shipment-document-actions"><button onClick={()=>history.back()}><ArrowLeft/> VOLTAR</button><button onClick={()=>window.print()}><Printer/> IMPRIMIR NOTA DE ENVIO</button></nav><article className="shipment-document">
    <header className="shipment-document-header"><div className="shipment-document-brand"><strong>RUAH</strong><span>PARFUMS</span></div><div><span>DOCUMENTO OPERACIONAL</span><h1>NOTA DE ENVIO</h1><dl><div><dt>Referência</dt><dd>{humanReference(shipment.id)}</dd></div><div><dt>Preparação / impressão</dt><dd>{shortDate(new Date().toISOString())}</dd></div><div><dt>Status</dt><dd>{operationalLabel(shipment.status)}</dd></div></dl></div></header>
    <section className="shipment-document-destination"><h2>Cliente e destino</h2><div className="shipment-document-grid"><div><small>CLIENTE</small><strong>{shipment.recipient_name}</strong>{shipment.recipient_phone&&<span>{shipment.recipient_phone}</span>}</div><div><small>DESTINATÁRIO</small><strong>{shipment.recipient_name}</strong></div><address><small>ENDEREÇO DO ENVIO</small>{addressLine&&<strong>{addressLine}</strong>}{shipment.recipient_district&&<span>Bairro: {shipment.recipient_district}</span>}{localityLine&&<span>{localityLine}</span>}{shipment.recipient_postal_code&&<span>CEP {shipment.recipient_postal_code}</span>}</address></div></section>
    <section className="shipment-document-logistics"><h2>Status e logística</h2><dl><div><dt>Status</dt><dd>{operationalLabel(shipment.status)}</dd></div><div><dt>Transportadora</dt><dd>{shipment.carrier||'—'}</dd></div><div><dt>Serviço</dt><dd>{shipment.service||'—'}</dd></div><div><dt>Frete</dt><dd>{freight==null?'—':brl(freight)}</dd></div><div><dt>Rastreio</dt><dd>{shipment.tracking_code||'Ainda não emitido'}</dd></div></dl></section>
    <section className="shipment-document-items"><h2>Itens para conferência</h2><table><thead><tr><th>Conferência</th><th>Perfume</th><th>ML</th></tr></thead><tbody>{items.map(item=><tr key={item.allocation_id}><td aria-label="Conferir item"><span className="shipment-check-box"/></td><td>{item.sales?.perfume_name_raw||'Perfume'}</td><td>{Number(item.quantity_ml).toLocaleString('pt-BR')} ml</td></tr>)}</tbody></table></section>
    <section className="shipment-document-summary"><div><h2>Resumo</h2><dl><div><dt>Itens</dt><dd>{items.length}</dd></div><div><dt>Total</dt><dd>{totalMl.toLocaleString('pt-BR')} ml</dd></div><div><dt>Frete</dt><dd>{freight==null?'—':brl(freight)}</dd></div></dl></div><div><h2>Conferência final</h2><ul>{['Todos os perfumes conferidos','Embalagem conferida','Etiqueta de transporte conferida','Pronto para postagem'].map(label=><li key={label}><span className="shipment-check-box"/>{label}</li>)}</ul></div></section>
    {shipment.notes&&<section className="shipment-document-notes"><h2>Observações do envio</h2><p>{shipment.notes}</p></section>}
    <section className="shipment-document-signature"><div><span>Separado por</span></div><div><span>Conferido por</span></div><div><span>Data / hora</span></div></section>
    <footer><span>RUAH Parfums</span><small>Documento operacional para separação e conferência. Não é documento fiscal.</small></footer>
  </article></main>
}
