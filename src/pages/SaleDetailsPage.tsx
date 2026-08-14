import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { brl, shortDate } from '../lib/format'
import { operationalLabel, statusLabel } from '../lib/presentation'
import {
  CommercialSale, confirmLegacyProductCustody, createDraftShipment, fetchSale360, releaseLegacyProductCustody,
} from '../lib/records'
import { DefinitionGroup, Divider, Modal, PrimaryButton, SecondaryButton } from '../components/ui'
import './SaleDetailsPage.css'

export function SaleDetailsPage({saleId}:{saleId:string}){
  const [sale,setSale]=useState<CommercialSale|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),[confirming,setConfirming]=useState(false),[confirmed,setConfirmed]=useState(false),[location,setLocation]=useState(''),[saving,setSaving]=useState(false)
  const [verificationNote,setVerificationNote]=useState('Produto conferido manualmente para envio.')
  const reload=()=>fetchSale360(saleId).then(setSale).catch(reason=>setError(reason instanceof Error?reason.message:'Venda não encontrada.'))
  useEffect(()=>{fetchSale360(saleId).then(setSale).catch(reason=>setError(reason instanceof Error?reason.message:'Venda não encontrada.'))},[saleId])
  if(error)return <div className="page"><div className="notice"><AlertTriangle/><span>{error}</span></div></div>
  if(!sale)return <div className="page"><div className="empty card"><h3>Carregando Venda 360…</h3></div></div>
  const allocation=sale.inventory_allocations?.find(item=>['reserved','shipping','shipped'].includes(item.status)),shipment=sale.shipment_items?.[0]?.shipments
  const prepare=async()=>{if(!sale.client_id||!allocation)return;setPreparing(true);setError('');try{const id=await createDraftShipment(sale.client_id,[allocation.id]);history.pushState({},'',`/entregas/${id}`);dispatchEvent(new PopStateEvent('popstate'))}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível preparar o envio.')}finally{setPreparing(false)}}
  const confirmCustody=async()=>{if(!confirmed)return;setSaving(true);setError('');try{await confirmLegacyProductCustody(sale.id,location,verificationNote);setConfirming(false);setConfirmed(false);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível confirmar o produto.')}finally{setSaving(false)}}
  const release=async()=>{if(!allocation)return;setSaving(true);try{await releaseLegacyProductCustody(allocation.id);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível remover a confirmação.')}finally{setSaving(false)}}
  const canConfirm=!allocation&&!shipment&&!sale.shipped_at&&Boolean(sale.client_id&&sale.perfume_id&&sale.volume_ml&&sale.volume_ml>0)
  const clientName=sale.clients?.name??sale.original_client??'Venda'

  return <div className="page sale-360 sale-ficha">
    <Modal open={confirming} onClose={()=>setConfirming(false)} eyebrow="CONFIRMAÇÃO HUMANA" title="Confirmar produto em custódia">
      <DefinitionGroup title="Resumo" items={[
        {label:'Cliente',value:sale.clients?.name||sale.original_client||'—'},
        {label:'Perfume',value:sale.perfume_name_raw||'—'},
        {label:'ML',value:sale.volume_ml?`${sale.volume_ml} ml`:'—'},
        {label:'Venda',value:brl(Number(sale.amount))},
      ]}/>
      <Divider/>
      <strong className="confirm-question">Você conferiu fisicamente este produto?</strong>
      <label className="confirm-checkbox">
        <input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
        <span>Confirmei que este produto está fisicamente em posse da RUAH e pertence a este cliente.</span>
      </label>
      <label className="field"><span>Caixa / localização</span><input value={location} onChange={event=>setLocation(event.target.value)} placeholder="Ex.: Caixa Érica, Prateleira 2"/></label>
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
      <p className="ficha-product" data-surface-role="secondary">{sale.perfume_name_raw||'Perfume não informado'}{sale.volume_ml?` · ${sale.volume_ml} ml`:''}{sale.sale_type?` · ${sale.sale_type}`:''}</p>
      <div className="ficha-price-row">
        <strong data-surface-role="metric">{brl(Number(sale.amount))}</strong>
        <span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]||sale.payment_status}</span>
      </div>
      <div className="ficha-actions">
        {sale.client_id&&<SecondaryButton onClick={()=>{history.pushState({},'',`/clientes/${sale.client_id}`);dispatchEvent(new PopStateEvent('popstate'))}}>Ver cliente</SecondaryButton>}
        {canConfirm&&<PrimaryButton onClick={()=>setConfirming(true)}>Confirmar produto</PrimaryButton>}
        {allocation?.status==='reserved'&&<PrimaryButton loading={preparing} onClick={prepare}>Preparar envio</PrimaryButton>}
        {shipment&&<a className="button-link" href={`/entregas/${shipment.id}`}>Abrir envio</a>}
      </div>
    </header>

    {error&&<div className="notice"><AlertTriangle/><span>{error}</span></div>}

    <Divider label="Cliente"/>
    <DefinitionGroup title="Contato" items={[
      {label:'Nome',value:sale.clients?.name||'—'},
      {label:'Telefone',value:sale.clients?.phone||sale.clients?.whatsapp_phone||'—'},
      {label:'E-mail',value:sale.clients?.email||'—'},
      {label:'Documento',value:sale.clients?.cpf||sale.clients?.cnpj||'—'},
      {label:'Endereço',value:[sale.clients?.address_line,sale.clients?.address_number,sale.clients?.city,sale.clients?.state].filter(Boolean).join(', ')||'—'},
    ]}/>

    <Divider label="Produto e pagamento"/>
    <section className="ficha-columns">
      <DefinitionGroup title="Produto" items={[
        {label:'Perfume',value:sale.perfume_name_raw||'—'},
        {label:'Tipo / volume',value:`${sale.sale_type||'—'} · ${sale.volume_ml??'—'} ml`},
        {label:'Origem',value:sale.source==='spreadsheet'?'Importação':'Manual'},
        {label:'Observações',value:sale.notes||'—'},
      ]}/>
      <DefinitionGroup title="Pagamento" items={[
        {label:'Valor',value:brl(Number(sale.amount))},
        {label:'Status',value:statusLabel[sale.payment_status]||sale.payment_status},
        {label:'Crédito',value:brl(Number(sale.credit_reference_amount||0))},
        {label:'Forma',value:sale.payment_method||'Não informada'},
        {label:'Data',value:sale.paid_at?shortDate(sale.paid_at):'Sem baixa'},
      ]}/>
    </section>

    <Divider label="Custódia e estoque"/>
    <DefinitionGroup title="Estoque" items={[
      {label:'Allocation',value:allocation?.status?operationalLabel(allocation.status):'Nenhuma operação de estoque vinculada'},
      {label:'Origem',value:allocation?.stock_managed?'Estoque operacional':allocation?'Conferido manualmente':'—'},
      {label:'Quantidade',value:allocation?`${Number(allocation.quantity_ml).toLocaleString('pt-BR')} ml`:'—'},
      {label:'Confirmado em',value:allocation?.verified_at?shortDate(allocation.verified_at):'—'},
      {label:'Localização',value:allocation?.storage_location||'—'},
    ]} action={allocation?.allocation_source==='legacy_manual_verified'&&allocation.status==='reserved'&&!allocation.shipment_id?<SecondaryButton loading={saving} onClick={release}>Remover confirmação</SecondaryButton>:undefined}/>

    <Divider label="Logística"/>
    <DefinitionGroup title="Envio" items={[
      {label:'Shipment',value:shipment?.id||'Ainda não preparado'},
      {label:'Status',value:shipment?.status?operationalLabel(shipment.status):sale.shipping_operational_status?operationalLabel(sale.shipping_operational_status):'—'},
      {label:'Transportadora',value:shipment?.carrier?`${shipment.carrier} · ${shipment.service||''}`:'—'},
      {label:'Rastreio',value:shipment?.tracking_code||'—'},
      {label:'Prazo histórico',value:sale.shipping_deadline_date?shortDate(sale.shipping_deadline_date):sale.shipping_deadline_raw||'—'},
      {label:'Envio histórico',value:sale.shipped_at?shortDate(sale.shipped_at):'—'},
    ]}/>
  </div>
}
