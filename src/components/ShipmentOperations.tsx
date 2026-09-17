import {useEffect,useMemo,useState} from 'react'
import {AlertTriangle,Copy,ExternalLink,RefreshCw,Truck,X} from 'lucide-react'
import {brl,shortDate} from '../lib/format'
import {approveShipmentForLabel,assumeShipmentConference,authenticatedOrganization,cancelCustomerShipmentRequestAsStaff,checkoutSuperFreteLabel,createSuperFreteCart,fetchClient360,fetchOperationalShipments,fetchReservedAllocations,fetchShipment360,fetchShippingSettings,OperationalShipment,quoteShipment,refreshShipmentRecipient,ReservedAllocation,saveShippingSettings,scanShipmentItemBottle,selectShipmentQuote,ShippingSettings,syncSuperFreteShipment,updateShipmentItemCheck,updateShipmentShippingData} from '../lib/records'
import {canBuyLabel,canQuoteShipment,getShipmentNextAction,missingLabelFields,missingQuoteFields,Stage,shipmentStage,shipmentStatusLabels,stageLabels} from '../lib/superfrete'
import {sortShipmentQueue,isUrgentShipment,shipmentIdFromScan} from '../lib/shipment-queue'
import {matchesShippingTask,ShippingTaskFilter} from '../lib/shipping-tasks'
import {friendlyIntegrationError,operationalLabel} from '../lib/presentation'
import {usePermissions,useOperationalSalesStartDate} from '../lib/PermissionsContext'
import {Shipment360View} from './Shipment360View'
import {SettingsTabs} from './SettingsTabs'
import {ShipmentProductSelector} from './ShipmentProductSelector'
import {useKeyboardWedgeListener} from './bottles/useKeyboardWedgeListener'
import {Divider, EmptyState, Modal, PageHeader} from './ui'
import './ShipmentOperations.css'

const nextActionCopy:Record<string,string>={approve_team:'Aprovar frete pelo time',create_label:'Criar etiqueta',checkout:'Confirmar compra',sync:'Atualizar etiqueta',print:'Imprimir etiqueta',track:'Acompanhar rastreio',none:'Sem ação pendente'}

const emptySettings:Partial<ShippingSettings>={default_format:'box',calculator_services:'1,2,17,3,31'}
const shipmentKeys=['recipient_name','recipient_phone','recipient_document','recipient_email','recipient_postal_code','recipient_address','recipient_number','recipient_complement','recipient_district','recipient_city','recipient_state','package_weight','package_height','package_width','package_length','declared_value'] as const
const approvalDate=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—'

function openShipment(id:string){history.pushState({},'',`/entregas/${id}`);dispatchEvent(new PopStateEvent('popstate'))}

const shippingTaskLabels:Record<ShippingTaskFilter,string>={quote:'Aguardando cotação',approval:'Aguardando aprovação do frete',conference:'Aguardando conferência',label:'Etiquetas para emitir',post:'Prontos para postar',data:'Clientes sem dados para envio'}

export function OperationalShipments({initialTask}:{initialTask?:ShippingTaskFilter}={}){
  const [rows,setRows]=useState<OperationalShipment[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[stageFilter,setStageFilter]=useState<Stage|''>('')
  const [taskFilter,setTaskFilter]=useState<ShippingTaskFilter|''>(initialTask??'')
  const [scanNotice,setScanNotice]=useState('')
  const reload=()=>fetchOperationalShipments().then(data=>{setRows(data);setError('')}).catch(reason=>setError(reason instanceof Error?reason.message:'Não foi possível carregar os envios.')).finally(()=>setLoading(false))
  useEffect(()=>{reload()},[])
  // Priority 0 (nota de controle impressa): Code128 carrega o shipment.id
  // inteiro — bipar aqui abre o envio direto, sem precisar procurar na
  // lista. Um código de frasco (RUAH-Fxxxxxx) nunca casa com a forma de
  // UUID, então os dois tipos de bipagem nunca se confundem.
  useKeyboardWedgeListener((value)=>{
    const shipmentId=shipmentIdFromScan(value)
    if(!shipmentId){setScanNotice(`"${value.trim()}" não é um código de envio.`);return}
    openShipment(shipmentId)
  })
  useEffect(()=>{if(!scanNotice)return;const timer=setTimeout(()=>setScanNotice(''),4000);return()=>clearTimeout(timer)},[scanNotice])
  const counts=useMemo(()=>rows.reduce((acc,row)=>{const stage=shipmentStage(row);acc[stage]=(acc[stage]||0)+1;return acc},{} as Record<string,number>),[rows])
  // Fase 4 do roadmap operacional ("Qual pedido preparo agora?"): urgente
  // primeiro, depois quem precisa de mais trabalho, depois o mais antigo —
  // nunca mais só "mais recente primeiro".
  const queue=useMemo(()=>sortShipmentQueue(rows),[rows])
  const visible=taskFilter?queue.filter(row=>matchesShippingTask(row,taskFilter)):stageFilter?queue.filter(row=>shipmentStage(row)===stageFilter):queue
  return <section className="shipment-operations">
    <div className="shipment-stage-tabs">
      <button className={!taskFilter&&stageFilter===''?'active':''} onClick={()=>{setStageFilter('');setTaskFilter('')}}>Todos<i>{rows.length}</i></button>
      {taskFilter&&<button className="active" onClick={()=>setTaskFilter('')}>{shippingTaskLabels[taskFilter]}<i>{visible.length}</i></button>}
      {(Object.keys(stageLabels) as Stage[]).map(stage=>counts[stage]?<button key={stage} className={!taskFilter&&stageFilter===stage?'active':''} onClick={()=>{setStageFilter(stage);setTaskFilter('')}}>{stageLabels[stage]}<i>{counts[stage]}</i></button>:null)}
    </div>
    {scanNotice&&<div className="notice"><AlertTriangle/><span>{scanNotice}</span></div>}
    {error?<div className="notice"><AlertTriangle/><span>{error}</span></div>:loading?<div className="inline-empty">Carregando envios…</div>:visible.length===0?<EmptyState icon={Truck} title="Nenhum envio nesta etapa" description="Use “Novo envio” para selecionar produtos reservados e iniciar uma etiqueta."/>:
    <div className="shipment-op-card-list">
      {visible.map(row=>{
        const items=row.shipment_items.length
        const ml=row.shipment_items.reduce((sum,item)=>sum+Number(item.quantity_ml),0)
        const nextAction=nextActionCopy[getShipmentNextAction(row)]
        return <article className="shipment-op-card" key={row.id}>
          <div className="shipment-op-card-head">
            <div><strong>{row.clients?.name||row.recipient_name}</strong><span>Envio #{row.id.slice(0,8).toUpperCase()} · {items} {items===1?'item':'itens'} · {ml} ml</span></div>
            <span className={`badge ${['posted','delivered'].includes(row.status)?'paid':'pending'}`}>{shipmentStatusLabels[row.status]||row.status}</span>
          </div>
          {isUrgentShipment(row)&&<span className="badge cancelled shipment-op-urgent">PRAZO PRÓXIMO — PREPARAR AGORA</span>}
          <div className="shipment-op-card-foot">
            <span>{row.service?`${row.carrier||''} ${row.service}`.trim():'Serviço não selecionado'}</span>
            {row.tracking_code&&<span>Rastreio: {row.tracking_code}</span>}
            <span>Criado em {shortDate(row.created_at)}</span>
            {nextAction&&nextAction!=='Sem ação pendente'&&<span className="shipment-op-next">Próxima ação: {nextAction}</span>}
          </div>
          <a className="ui-btn ui-btn--tertiary button-link" href={`/entregas/${row.id}`}>Abrir envio</a>
        </article>
      })}
    </div>}
  </section>
}

export function NewShipmentModal({close,preselectedSaleId}:{close:()=>void;preselectedSaleId?:string}){
  const operationalStart=useOperationalSalesStartDate()
  const [rows,setRows]=useState<ReservedAllocation[]>([]),[clientId,setClientId]=useState(''),[clientData,setClientData]=useState<Awaited<ReturnType<typeof fetchClient360>>|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [showHistorical,setShowHistorical]=useState(false)
  // Fila de seleção respeita o corte operacional por padrão — filtrado no
  // servidor (reserved_allocations_for_shipment), não baixando o histórico
  // inteiro para escondê-lo em React. "Mostrar histórico anterior" busca de
  // novo com o histórico completo (não é exclusão de dado, só de consulta).
  useEffect(()=>{fetchReservedAllocations(showHistorical).then(async data=>{setRows(data);const initial=data.find(row=>row.sale_id===preselectedSaleId);if(initial){setClientId(initial.client_id);setClientData(await fetchClient360(initial.client_id))}}).catch(reason=>setError(reason instanceof Error?reason.message:'Não foi possível carregar os produtos.')).finally(()=>setLoading(false))},[preselectedSaleId,showHistorical])
  const toggleHistorical=(checked:boolean)=>{setLoading(true);setShowHistorical(checked)}
  const clients=Array.from(new Map(rows.map(row=>[row.client_id,row.clients?.name||'Cliente sem nome'])))
  const chooseClient=async(value:string)=>{setClientId(value);setClientData(null);setError('');if(!value)return;setLoading(true);try{setClientData(await fetchClient360(value))}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível carregar as compras da cliente.')}finally{setLoading(false)}}
  return <Modal open onClose={close} eyebrow="LOGÍSTICA OPERACIONAL" title="Novo envio" footer={<button onClick={close}>Cancelar</button>}>
    {loading?<div className="inline-empty">Carregando produtos reservados…</div>:<div className="record-form">
      <div className="new-shipment-steps">
        <span className={clientId?'done':'current'}>1. Cliente</span>
        <span className={clientId?'current':''}>2. Produtos</span>
      </div>
      {operationalStart&&<label className="field-inline-toggle"><input type="checkbox" checked={showHistorical} onChange={event=>toggleHistorical(event.target.checked)}/><span>Mostrar histórico anterior</span></label>}
      <label className="field"><span>Cliente</span><select value={clientId} onChange={event=>void chooseClient(event.target.value)}><option value="">Selecione…</option>{clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      {clientId&&clientData&&<ShipmentProductSelector clientId={clientId} sales={clientData.history} waiting={clientData.waiting} onCreated={id=>{history.pushState({},'',`/entregas/${id}`);dispatchEvent(new PopStateEvent('popstate'));close()}}/>}
      {error&&<div className="form-error">{error}</div>}
    </div>}
  </Modal>
}

export function ShipmentDetailsPage({shipmentId}:{shipmentId:string}){
  const [shipment,setShipment]=useState<OperationalShipment|null>(null),[editing,setEditing]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(''),[feedback,setFeedback]=useState(''),[isAdmin,setIsAdmin]=useState(false),[currentUserId,setCurrentUserId]=useState('')
  const reload=async()=>{try{setShipment(await fetchShipment360(shipmentId));setError('')}catch(reason){setError(reason instanceof Error?reason.message:'Envio não encontrado.')}}
  useEffect(()=>{let active=true;fetchShipment360(shipmentId).then(data=>{if(active){setShipment(data);setError('')}}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Envio não encontrado.')});return()=>{active=false}},[shipmentId])
  useEffect(()=>{authenticatedOrganization().then(context=>{setIsAdmin(context.role==='admin');setCurrentUserId(context.user.id)}).catch(()=>setIsAdmin(false))},[])
  if(error&&!shipment)return <div className="page"><div className="notice"><AlertTriangle/><span>{error}</span></div></div>
  if(!shipment)return <div className="page"><div className="empty card"><h3>Carregando Envio 360…</h3></div></div>
  const items=[...shipment.shipment_items].sort((a,b)=>String(a.sales?.perfume_name_raw||'').localeCompare(String(b.sales?.perfume_name_raw||''),'pt-BR'))
  const change=async(item:typeof items[number],kind:'separated'|'checked',value:boolean)=>{try{await updateShipmentItemCheck(shipment.id,item.allocation_id,kind==='separated'?value:Boolean(item.separated_at),kind==='checked'?value:Boolean(item.checked_at),item.divergence_note||'');await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar a conferência.')}}
  const divergence=async(item:typeof items[number],value:string)=>{try{await updateShipmentItemCheck(shipment.id,item.allocation_id,Boolean(item.separated_at),Boolean(item.checked_at),value);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível registrar a divergência.')}}
  const scanBottle=async(item:typeof items[number],rawValue:string)=>{const result=await scanShipmentItemBottle(shipment.id,item.allocation_id,rawValue);if(result.ok)await reload();return result}
  const assumeConference=async()=>{if(!confirm('ASSUMIR CONFERÊNCIA\n\nAo confirmar, você ficará registrado como responsável por esta conferência e não poderá ser alterado.'))return;try{await assumeShipmentConference(shipment.id);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível assumir a conferência.')}}
  const sync=async()=>{if(busy)return;const before=[shipment.superfrete_status,shipment.tracking_code,shipment.print_url,shipment.print_available].join('|');setBusy('sync');setError('');setFeedback('');try{await syncSuperFreteShipment(shipment.id);const updated=await fetchShipment360(shipment.id);setShipment(updated);const after=[updated.superfrete_status,updated.tracking_code,updated.print_url,updated.print_available].join('|');setFeedback(before===after?'Etiqueta atualizada. Nenhuma alteração encontrada na SuperFrete.':'Etiqueta atualizada. Status atualizado.')}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar a etiqueta. Tente novamente. A etiqueta existente continua preservada.')}finally{setBusy('')}}
  const checkout=async()=>{if(!confirm(`CONFIRMAR COMPRA REAL DA ETIQUETA\n\nCliente: ${shipment.recipient_name}\nServiço: ${shipment.carrier||''} ${shipment.service||''}\nValor: ${brl(Number(shipment.shipping_price||0))}\n\nEsta ação utilizará saldo real da SuperFrete. Continuar?`))return;setBusy('checkout');setError('');try{await checkoutSuperFreteLabel(shipment.id);await syncSuperFreteShipment(shipment.id);await reload()}catch(reason){setError(reason instanceof Error?reason.message:'A compra pode exigir reconciliação. Não tente novamente antes de atualizar o pedido.')}finally{setBusy('')}}
  const copyTracking=async()=>{const code=String(shipment.tracking_code||'');if(!code)return;setFeedback('');try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(code);else{const input=document.createElement('textarea');input.value=code;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();if(!document.execCommand('copy'))throw new Error('copy_failed');input.remove()}setFeedback('Código de rastreio copiado.')}catch{setFeedback(`Não foi possível copiar automaticamente. Código: ${code}`)}}
  const printLabel=()=>{const url=shipment.print_url||shipment.label_pdf_url;if(!shipment.print_available||!url){setFeedback('A SuperFrete ainda não liberou o arquivo para impressão.');return}const tab=window.open('','_blank');if(!tab){setFeedback('O navegador bloqueou a nova aba. Permita pop-ups para imprimir.');return}tab.opener=null;tab.location.href=url;setFeedback('Etiqueta aberta em uma nova aba.')}
  return <div className="page shipment-360">{editing&&<ShipmentEditor shipment={shipment} close={()=>setEditing(false)} saved={async()=>{setEditing(false);await reload()}} refreshed={reload}/>}<button className="back-link" onClick={()=>history.back()}>← Voltar para entregas</button>{error&&<div className="notice shipment-page-error"><AlertTriangle/><span>{error}</span></div>}<Shipment360View shipment={shipment} items={items} onEdit={()=>setEditing(true)} onSync={sync} onCheckout={checkout} onPrint={printLabel} onCopy={copyTracking} busy={busy} feedback={feedback} isAdmin={isAdmin} currentUserId={currentUserId} onAssumeConference={assumeConference} onChange={change} onDivergence={divergence} onScanBottle={scanBottle}/></div>
}

export function ShipmentEditor({shipment,close,saved,refreshed}:{shipment:OperationalShipment;close:()=>void;saved:()=>void;refreshed:()=>Promise<void>}){
  const [form,setForm]=useState<Record<string,string>>(()=>Object.fromEntries(shipmentKeys.map(key=>[key,String((shipment as unknown as Record<string,unknown>)[key]??'')])))
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[senderConfigured,setSenderConfigured]=useState<boolean|null>(null)
  const {can}=usePermissions(),canApproveFreight=can('shipping.label')
  useEffect(()=>{fetchShippingSettings().then(settings=>setSenderConfigured(Boolean(settings))).catch(()=>setSenderConfigured(false))},[])
  const live={...shipment,...form},quoteMissing=missingQuoteFields(live),labelMissing=missingLabelFields(live),conferenceComplete=shipment.shipment_items.length>0&&shipment.shipment_items.every(item=>item.checked_at&&!item.divergence_note)
  const paymentComplete=shipment.shipment_items.length>0&&shipment.shipment_items.every(item=>item.sales?.payment_status==='paid')
  const splitComplete=shipment.shipment_items.length>0&&shipment.shipment_items.every(item=>!['SPLIT','APC'].includes(String(item.sales?.sale_type||'').toUpperCase())||Boolean(item.sales?.split_completed_at))
  const client=shipment.clients,snapshotStale=Boolean(client&&[[shipment.recipient_name,client.name],[shipment.recipient_phone,client.phone||client.whatsapp_phone],[shipment.recipient_document,client.cpf||client.cnpj],[shipment.recipient_postal_code,client.postal_code],[shipment.recipient_address,client.address_line],[shipment.recipient_number,client.address_number],[shipment.recipient_complement,client.complement],[shipment.recipient_district,client.district],[shipment.recipient_city,client.city],[shipment.recipient_state,client.state]].some(([snapshot,current])=>String(snapshot??'').trim()!==String(current??'').trim()))
  const act=async(label:string,fn:()=>Promise<unknown>,confirmation?:string,onSuccess:()=>void|Promise<void>=saved)=>{if(confirmation&&!confirm(confirmation))return;setBusy(label);setError('');try{await fn();await onSuccess()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível concluir a ação.')}finally{setBusy('')}}
  const payload=()=>({...form,package_format:'box',fiscal_mode:'declaration'})
  const save=()=>act('save',()=>updateShipmentShippingData(shipment.id,payload()),undefined,refreshed)
  const calculate=()=>act('quote',async()=>{await updateShipmentShippingData(shipment.id,payload());await quoteShipment(shipment.id)},undefined,refreshed)
  const confirmation=`CONFIRMAR COMPRA REAL DA ETIQUETA\n\nCliente: ${shipment.recipient_name}\nCEP: ${shipment.recipient_postal_code}\nEndereço: ${shipment.recipient_address}, ${shipment.recipient_number}\nServiço: ${shipment.carrier||''} ${shipment.service||''}\nValor: ${brl(Number(shipment.shipping_price||0))}\nPeso: ${shipment.package_weight} kg\nDimensões: ${shipment.package_length} × ${shipment.package_width} × ${shipment.package_height} cm\n\nEsta ação utilizará saldo real da SuperFrete. Continuar?`
  return <div className="modal-layer"><button className="modal-scrim" aria-label="Fechar" onClick={close}/><div className="modal-panel shipment-panel"><div className="modal-title"><div><span>ENVIO · SUPERFRETE</span><h2>{shipment.recipient_name}</h2></div><button onClick={close}><X/></button></div><div className="record-form">
    <div className="shipment-state"><span className="badge pending">{operationalLabel(shipment.status)}</span>{shipment.integration_error&&<em title={shipment.integration_error}>{friendlyIntegrationError(shipment.integration_error)}</em>}</div>
    <div className="shipment-products"><h3>Produtos neste envio</h3>{shipment.shipment_items.map(item=><div key={item.sales?.id||item.quantity_ml}><span>{item.sales?.perfume_name_raw||'Produto'}</span><strong>{item.quantity_ml} ml · {brl(Number(item.sales?.amount||0))}</strong></div>)}</div>
    {senderConfigured===false&&<div className="incomplete-data"><AlertTriangle/><div><strong>REMETENTE DA SUPERFRETE NÃO CONFIGURADO</strong><span>Cadastre o remetente real e o pacote padrão antes de calcular.</span><a href="/configuracoes">Abrir configurações <ExternalLink/></a></div></div>}
    {snapshotStale&&(shipment.superfrete_order_id?<div className="incomplete-data"><AlertTriangle/><div><strong>ESTA ETIQUETA JÁ FOI EMITIDA COM OS DADOS ANTERIORES</strong><span>O cadastro atual da cliente foi preservado, mas este pedido externo não pode ser atualizado automaticamente.</span></div></div>:<div className="incomplete-data"><AlertTriangle/><div><strong>DADOS DA CLIENTE ATUALIZADOS</strong><span>Este envio ainda está usando informações anteriores.</span><button disabled={!!busy} onClick={()=>act('refresh',()=>refreshShipmentRecipient(shipment.id),undefined,refreshed)}>ATUALIZAR DADOS DESTE ENVIO</button></div></div>)}
    {canQuoteShipment(shipment.status)&&<div className="shipping-required-intro"><strong>DADOS NECESSÁRIOS PARA ENVIO</strong><span>Preencha todos os campos obrigatórios abaixo para calcular o frete e emitir a etiqueta. Complemento é opcional.</span></div>}
    {canQuoteShipment(shipment.status)&&<><div className="section-heading"><h3>Destinatário</h3><button onClick={()=>act('refresh',()=>refreshShipmentRecipient(shipment.id))}><RefreshCw/> Atualizar do Cliente 360°</button></div><div className="form-grid">{[['recipient_name','Nome'],['recipient_phone','Telefone'],['recipient_document','CPF/CNPJ'],['recipient_email','E-mail'],['recipient_postal_code','CEP'],['recipient_address','Endereço'],['recipient_number','Número'],['recipient_complement','Complemento'],['recipient_district','Bairro'],['recipient_city','Cidade'],['recipient_state','UF']].map(([key,label])=><label className={`field ${key==='recipient_address'?'wide':''}`} key={key}><span>{label}</span><input value={form[key]} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>)}</div><h3>Pacote e valor</h3><div className="form-grid">{[['package_weight','Peso (kg)'],['package_height','Altura (cm)'],['package_width','Largura (cm)'],['package_length','Comprimento (cm)'],['declared_value','Valor declarado']].map(([key,label])=><label className="field" key={key}><span>{label}</span><input inputMode="decimal" value={form[key]} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>)}</div>{quoteMissing.length>0&&<div className="incomplete-data"><AlertTriangle/><div><strong>DADOS PARA COTAÇÃO INCOMPLETOS</strong><span>{quoteMissing.join(', ')}</span></div></div>}<div className="form-actions"><button disabled={!!busy} onClick={save}>Salvar dados</button><button className="primary" disabled={!!busy||quoteMissing.length>0} onClick={calculate}>CALCULAR FRETE</button></div></>}
    {shipment.shipment_quotes?.length>0&&canQuoteShipment(shipment.status)&&<div className="quote-grid">{shipment.shipment_quotes.map(quote=><button disabled={!quote.available||!!busy} key={quote.id} onClick={()=>act('select',()=>selectShipmentQuote(shipment.id,quote.id),undefined,refreshed)}><strong>{quote.carrier} · {quote.service_name}</strong><span>{brl(Number(quote.price))}</span><small>{quote.delivery_days?`${quote.delivery_days} dias úteis`:(quote.safe_error||'Prazo não informado')}</small></button>)}</div>}
    {shipment.status==='awaiting_customer_approval'&&<div className="approval-box"><strong>AGUARDANDO APROVAÇÃO DO TIME</strong><span>{shipment.carrier} · {shipment.service} · {brl(Number(shipment.shipping_price))}</span>{canApproveFreight?<button className="primary" disabled={!!busy} onClick={()=>act('approve-team',()=>approveShipmentForLabel(shipment.id),`APROVAR FRETE PELO TIME\n\nCliente: ${shipment.recipient_name}\nServiço: ${shipment.carrier||''} ${shipment.service||''}\nValor: ${brl(Number(shipment.shipping_price||0))}\n\nA aprovação libera a preparação da etiqueta. Continuar?`,refreshed)}>APROVAR FRETE PELO TIME</button>:<small>Seu acesso não permite aprovar fretes.</small>}{shipment.customer_shipment_requests?.length?<button disabled={!!busy} onClick={()=>act('cancel-request',()=>cancelCustomerShipmentRequestAsStaff(shipment.id),'Cancelar esta solicitação e devolver os itens para a custódia disponível?')}>CANCELAR SOLICITAÇÃO</button>:null}</div>}
    {shipment.status==='customer_approved'&&<div className="approval-box"><strong>✓ APROVADO PELO TIME</strong><span>{shipment.carrier} · {shipment.service} · {brl(Number(shipment.shipping_price))}</span><small>Aprovado em {approvalDate(shipment.customer_approved_at)} · fluxo interno RUAH</small>{shipment.customer_shipment_requests?.length?<button disabled={!!busy} onClick={()=>act('cancel-request',()=>cancelCustomerShipmentRequestAsStaff(shipment.id),'Cancelar esta solicitação e devolver os itens para a custódia disponível?')}>CANCELAR SOLICITAÇÃO</button>:null}</div>}
    {shipment.status==='customer_approved'&&<>{!paymentComplete?<div className="incomplete-data"><AlertTriangle/><div><strong>PAGAMENTO PENDENTE</strong><span>Todos os produtos deste envio precisam estar pagos antes da emissão da etiqueta.</span></div></div>:!splitComplete?<div className="incomplete-data"><AlertTriangle/><div><strong>SEPARAÇÃO FÍSICA PENDENTE</strong><span>Finalize a separação física de todos os itens deste envio antes de emitir a etiqueta.</span></div></div>:!conferenceComplete?<div className="incomplete-data"><AlertTriangle/><div><strong>CONFERÊNCIA INCOMPLETA</strong><span>Confira todos os itens e resolva as divergências no Envio 360 antes de emitir a etiqueta.</span></div></div>:labelMissing.length>0?<div className="incomplete-data"><AlertTriangle/><div><strong>DADOS DE ENVIO INCOMPLETOS</strong><span>{labelMissing.join(', ')}</span><a href={`/clientes/${shipment.client_id}`}>Completar dados do cliente <ExternalLink/></a></div></div>:shipment.checkout_status==='cart_created'?<button className="primary buy-label" disabled={!!busy} onClick={()=>act('checkout',()=>checkoutSuperFreteLabel(shipment.id),confirmation)}>CONFIRMAR COMPRA E EMITIR ETIQUETA</button>:<button className="primary buy-label" disabled={!!busy||!canBuyLabel(shipment.status,labelMissing)} onClick={()=>act('cart',()=>createSuperFreteCart(shipment.id),undefined,refreshed)}>PREPARAR PEDIDO NA SUPERFRETE</button>}</>}
    {shipment.superfrete_order_id&&<div className="approval-box"><strong>ETIQUETA</strong><span>Status: {shipment.print_available?'Liberada':shipment.superfrete_status==='pending'?'Etiqueta sendo preparada':'Arquivo indisponível'}</span><span>Rastreio: {shipment.tracking_code||'Aguardando geração'}</span>{!shipment.print_available&&<small>{shipment.superfrete_status==='pending'?'Sua etiqueta está sendo preparada pela SuperFrete. Sincronize novamente em alguns instantes.':'A etiqueta foi criada, mas a SuperFrete ainda não liberou o arquivo para impressão.'}</small>}<div className="shipment-actions"><button aria-busy={busy==='sync'} disabled={!!busy} onClick={()=>act('sync',()=>syncSuperFreteShipment(shipment.id),undefined,refreshed)}><RefreshCw className={busy==='sync'?'spin':''}/> {busy==='sync'?'ATUALIZANDO ETIQUETA…':'ATUALIZAR ETIQUETA'}</button>{shipment.print_available&&(shipment.print_url||shipment.label_pdf_url)?<a href={shipment.print_url||shipment.label_pdf_url||'#'} target="_blank" rel="noreferrer">IMPRIMIR ETIQUETA <ExternalLink/></a>:<button disabled>IMPRIMIR ETIQUETA</button>}{shipment.tracking_code&&<button onClick={()=>navigator.clipboard.writeText(shipment.tracking_code!)}><Copy/> Copiar rastreio</button>}</div></div>}
    {['cart_uncertain','checkout_uncertain'].includes(String(shipment.checkout_status))&&<div className="incomplete-data"><AlertTriangle/><div><strong>RECONCILIAÇÃO NECESSÁRIA</strong><span>A operação não será repetida. Use “Sincronizar status” para consultar o pedido existente.</span></div></div>}
    {error&&<div className="form-error">{error}</div>}</div></div></div>
}

export function ShippingSettingsPage(){
  const [form,setForm]=useState<Partial<ShippingSettings>>(emptySettings),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState('')
  const [configured,setConfigured]=useState(false)
  useEffect(()=>{fetchShippingSettings().then(data=>{setConfigured(Boolean(data));setForm(data||emptySettings)}).catch(()=>setMessage('Não foi possível carregar a configuração.')).finally(()=>setLoading(false))},[])
  const set=(key:keyof ShippingSettings,value:string)=>setForm(current=>({...current,[key]:value}))
  const required:[keyof ShippingSettings,string][]=[['sender_name','Nome / razão social'],['sender_document','CPF/CNPJ'],['sender_email','E-mail'],['sender_phone','Telefone'],['sender_postal_code','CEP'],['sender_address','Endereço'],['sender_number','Número'],['sender_district','Bairro'],['sender_city','Cidade'],['sender_state','UF'],['default_weight','Peso padrão'],['default_height','Altura padrão'],['default_width','Largura padrão'],['default_length','Comprimento padrão']]
  const missing=required.filter(([key])=>!String(form[key]??'').trim()).map(([,label])=>label)
  const submit=async()=>{if(missing.length){setMessage(`Preencha os campos obrigatórios: ${missing.join(', ')}.`);return}setSaving(true);setMessage('');try{await saveShippingSettings(form);setConfigured(true);setMessage('Configuração salva e persistida. O token continua somente nos Secrets do Supabase.')}catch(reason){setMessage(reason instanceof Error?reason.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <div className="page"><SettingsTabs active="frete"/><PageHeader eyebrow="CONFIGURAÇÕES" title="Frete" description="Remetente e pacote padrão da operação logística."/><div className="card settings-card"><div className="card-title"><div><h3>SuperFrete — Produção</h3><p>Nenhuma credencial é armazenada ou exibida no navegador.</p></div><span className="live-dot">{configured?'CONFIGURADO':'CONFIGURAÇÃO PENDENTE'}</span></div>{loading?<div className="inline-empty">Carregando…</div>:<div className="record-form">{!configured&&<div className="incomplete-data"><AlertTriangle/><div><strong>SUPERFRETE AINDA NÃO ESTÁ PRONTA PARA USO</strong><span>Preencha o remetente real e o pacote padrão. Sem isso, o cálculo de frete será bloqueado com segurança.</span></div></div>}
    <Divider label="Remetente"/>
    <div className="form-grid">{([['sender_name','Nome do remetente'],['sender_document','CPF/CNPJ'],['sender_email','E-mail'],['sender_phone','Telefone'],['sender_postal_code','CEP'],['sender_address','Endereço'],['sender_number','Número'],['sender_complement','Complemento'],['sender_district','Bairro'],['sender_city','Cidade'],['sender_state','UF']] as [keyof ShippingSettings,string][]).map(([key,label])=><label className={`field ${key==='sender_address'?'wide':''}`} key={key}><span>{label}{required.some(([requiredKey])=>requiredKey===key)&&' *'}</span><input value={String(form[key]??'')} onChange={event=>set(key,event.target.value)}/></label>)}</div>
    <Divider label="Pacote padrão"/>
    <div className="form-grid">{([['default_weight','Peso padrão (kg)'],['default_height','Altura padrão (cm)'],['default_width','Largura padrão (cm)'],['default_length','Comprimento padrão (cm)']] as [keyof ShippingSettings,string][]).map(([key,label])=><label className="field" key={key}><span>{label}{required.some(([requiredKey])=>requiredKey===key)&&' *'}</span><input value={String(form[key]??'')} onChange={event=>set(key,event.target.value)}/></label>)}</div>
    <Divider label="Integração"/>
    <div className="form-grid"><label className="field wide"><span>Serviços (IDs separados por vírgula)</span><input value={String(form.calculator_services??'')} onChange={event=>set('calculator_services',event.target.value)}/></label></div>
    {missing.length>0&&<div className="incomplete-data"><AlertTriangle/><div><strong>CAMPOS OBRIGATÓRIOS AUSENTES</strong><span>{missing.join(', ')}</span></div></div>}{message&&<div className="notice"><span>{message}</span></div>}<div className="form-actions"><button className="primary" disabled={saving} onClick={submit}>{saving?'Salvando…':'Salvar configuração'}</button></div></div>}</div></div>
}
