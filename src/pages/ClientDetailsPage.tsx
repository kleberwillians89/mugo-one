import { useEffect, useState } from 'react'
import { AlertTriangle, Boxes, Filter, ShoppingBag } from 'lucide-react'
import { brl, monthYearLabel, shortDate, integer } from '../lib/format'
import { ClientModal } from '../components/RecordModals'
import { operationalLabel, statusLabel } from '../lib/presentation'
import { ClientPortalStatus, createDraftShipment, fetchClient360, fetchClientPortalStatus, inviteCustomerAccount } from '../lib/records'
import { missingShippingClientFields } from '../lib/client-completeness'
import { Alert, DefinitionGroup, Divider, Drawer, EmptyState, Modal, PrimaryButton, SecondaryButton, SectionHeader, Stepper } from '../components/ui'
import './ClientDetailsPage.css'

/** Coarse status → step index for the compact client-card journey. Only
 * `shipment.status` is available from fetchClient360 (no item-level
 * separated/checked flags), so this stays intentionally coarse — the
 * detailed per-item journey lives in Envio 360 itself. */
const JOURNEY_STEPS = ['Produtos', 'Frete', 'Etiqueta', 'Postagem', 'Entrega']
function journeyIndex(status: string) {
  if (status === 'delivered') return 4
  if (status === 'posted') return 3
  if (status === 'label_pending' || status === 'label_released') return 2
  if (status === 'awaiting_customer_approval' || status === 'customer_approved') return 1
  return 0
}

/** Aba "Portal / Custódia": status da conta Minha RUAH + ativação
 * ("ENVIAR ACESSO"). Nunca impersona a cliente — só lê o status via
 * client_portal_status (RPC staff-only) e dispara o convite nativo do
 * Supabase Auth via customer-account-invite (Edge Function). */
function ClientPortalCard({clientId,defaultEmail,phone}:{clientId:string;defaultEmail:string;phone:string}) {
  const [status,setStatus]=useState<ClientPortalStatus|null>(null)
  const [email,setEmail]=useState(defaultEmail),[sending,setSending]=useState(false),[feedback,setFeedback]=useState(''),[inviteOpen,setInviteOpen]=useState(false)
  const [emailChannel,setEmailChannel]=useState(true),[whatsappChannel,setWhatsappChannel]=useState(Boolean(phone))
  const reload=()=>fetchClientPortalStatus(clientId).then(setStatus).catch(()=>{})
  useEffect(()=>{reload()},[clientId])
  const invite=async()=>{if((emailChannel&&!email.includes('@'))||(!emailChannel&&!whatsappChannel))return;setSending(true);setFeedback('');try{const result=await inviteCustomerAccount(clientId,email,{email:emailChannel,whatsapp:whatsappChannel});const label=(channel:{status:string})=>channel.status==='sent'?'enviado':channel.status==='not_configured'?'não configurado':channel.status==='unavailable'?'indisponível':'falhou';setFeedback(`E-mail: ${label(result.channels.email)} · WhatsApp: ${label(result.channels.whatsapp)}`);setInviteOpen(false);await reload()}catch(reason){setFeedback(reason instanceof Error?reason.message:'Não foi possível enviar o acesso.')}finally{setSending(false)}}
  const active=status?.account_status==='active'
  return <section className="dossier-columns"><DefinitionGroup title="Portal Minha RUAH" items={[
    {label:'Conta',value:active?'ATIVA':status?.account_status==='pending_verification'?'CONVITE ENVIADO':'NÃO ATIVADA'},
    {label:'E-mail',value:status?.sent_email_at?'ENVIADO':'NÃO ENVIADO'},
    {label:'WhatsApp',value:status?.sent_whatsapp_at?'ENVIADO':phone?'NÃO ENVIADO':'INDISPONÍVEL'},
    {label:'Último convite',value:status?.last_invited_at?new Date(status.last_invited_at).toLocaleString('pt-BR'):'—'},
    {label:'Solicitações abertas',value:integer(status?.open_requests??0)},
    {label:'Tickets abertos',value:integer(status?.open_tickets??0)},
  ]}/>
  <div>
    {!active&&<SecondaryButton onClick={()=>setInviteOpen(true)}>{status?.account_status==='pending_verification'?'Reenviar convite':'Convidar para Minha RUAH'}</SecondaryButton>}
    {feedback&&<small>{feedback}</small>}
    <Modal open={inviteOpen} onClose={()=>setInviteOpen(false)} eyebrow="MINHA RUAH" title="Enviar convite">
      <div className="record-form"><p>Escolha os canais para este mesmo acesso. Cada canal terá resultado independente.</p>
        <label className="confirm-checkbox"><input type="checkbox" checked={emailChannel} onChange={event=>setEmailChannel(event.target.checked)}/><span><strong>E-mail</strong><br/>{email||'E-mail não cadastrado'}</span></label>
        <label className="field"><span>E-mail do convite</span><input value={email} onChange={event=>setEmail(event.target.value)} placeholder="cliente@email.com"/></label>
        <label className="confirm-checkbox"><input type="checkbox" disabled={!phone} checked={whatsappChannel} onChange={event=>setWhatsappChannel(event.target.checked)}/><span><strong>WhatsApp</strong><br/>{phone||'WhatsApp indisponível'}</span></label>
        <div className="form-actions"><SecondaryButton onClick={()=>setInviteOpen(false)}>Cancelar</SecondaryButton><PrimaryButton loading={sending} disabled={(!emailChannel&&!whatsappChannel)||(emailChannel&&!email.includes('@'))} onClick={invite}>Enviar convite</PrimaryButton></div>
      </div>
    </Modal>
  </div></section>
}

export function ClientDetailsPage({clientId}:{clientId:string}) {
  const [data,setData]=useState<Awaited<ReturnType<typeof fetchClient360>>|null>(null)
  const [selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[preparing,setPreparing]=useState(false),[editing,setEditing]=useState(false)
  const [historySearch,setHistorySearch]=useState(''),[historyPayment,setHistoryPayment]=useState(''),[historyType,setHistoryType]=useState(''),[historyShipping,setHistoryShipping]=useState(''),[historyStart,setHistoryStart]=useState(''),[historyEnd,setHistoryEnd]=useState('')
  const [purchase,setPurchase]=useState<Record<string,unknown>|null>(null)
  const [filtersOpen,setFiltersOpen]=useState(false)
  useEffect(()=>{fetchClient360(clientId).then(setData).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o cliente.'))},[clientId])
  if(error)return <div className="page"><div className="notice"><AlertTriangle/><span>{error}</span></div></div>
  if(!data)return <div className="page"><div className="empty card"><h3>Carregando Cliente 360°…</h3></div></div>
  const {client}=data.profile,commercial=data.profile.commercial
  const visibleHistory=data.history.filter((sale)=>
    (!historySearch||String(sale.perfume_name_raw??'').toLowerCase().includes(historySearch.toLowerCase()))&&
    (!historyPayment||sale.payment_status===historyPayment)&&(!historyType||sale.sale_type===historyType)&&
    (!historyShipping||(historyShipping==='shipped'?Boolean(sale.shipped_at):!sale.shipped_at))&&
    (!historyStart||String(sale.sale_date??'')>=historyStart)&&(!historyEnd||String(sale.sale_date??'')<=historyEnd))
  const editInitial={name:client.name,phone:client.phone??'',whatsappPhone:client.whatsapp_phone??'',email:client.email??'',instagram:client.instagram??'',cpf:client.cpf??'',cnpj:client.cnpj??'',birthDate:client.birth_date??'',postalCode:client.postal_code??'',address:client.address_line??'',addressNumber:client.address_number??'',complement:client.complement??'',district:client.district??'',city:client.city??'',state:client.state??'',notes:client.notes??'',status:client.status}
  const prepare=async()=>{if(!selected.length||missingFields.length)return;setPreparing(true);setError('');try{const shipmentId=await createDraftShipment(clientId,selected);setSelected([]);const refreshed=await fetchClient360(clientId);setData(refreshed);alert(`Envio preparado: ${shipmentId.slice(0,8)}`)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível preparar o envio.')}finally{setPreparing(false)}}

  const waitingSorted=[...data.waiting].sort((a,b)=>a.perfume.localeCompare(b.perfume,'pt-BR'))
  const currentShipments=data.shipments.filter((s)=>!['delivered','cancelled'].includes(String(s.status)))
  const historicalShipments=data.shipments.filter((s)=>['delivered','cancelled'].includes(String(s.status)))

  const missingFields=missingShippingClientFields(client)

  const activeHistoryFilterCount=[historyPayment,historyType,historyShipping,historyStart,historyEnd].filter(Boolean).length
  const clearHistoryFilters=()=>{setHistoryPayment('');setHistoryType('');setHistoryShipping('');setHistoryStart('');setHistoryEnd('')}

  return <div className="page client-360 client-dossier">
    {purchase&&<Modal open onClose={()=>setPurchase(null)} eyebrow="DETALHES DA COMPRA" title={String(purchase.perfume_name_raw??'Venda')}>
      <DefinitionGroup title="Compra" items={[
        {label:'Data',value:purchase.sale_date?shortDate(String(purchase.sale_date)):'—'},
        {label:'Valor',value:brl(Number(purchase.amount))},
        {label:'Pagamento',value:statusLabel[String(purchase.payment_status)]},
        {label:'Forma',value:String(purchase.payment_method??'—')},
        {label:'Origem',value:purchase.source==='spreadsheet'?'Planilha':'Manual'},
        {label:'Prazo',value:purchase.shipping_deadline_date?shortDate(String(purchase.shipping_deadline_date)):String(purchase.shipping_deadline_raw??'—')},
        {label:'Envio',value:purchase.shipped_at?shortDate(String(purchase.shipped_at)):'—'},
        {label:'Observação',value:String(purchase.notes??'—')},
      ]}/>
    </Modal>}
    {editing&&<ClientModal clientId={clientId} initial={editInitial} close={()=>setEditing(false)} onSaved={()=>fetchClient360(clientId).then(setData)}/>}

    <button className="back-link" onClick={()=>{history.pushState({},'','/clientes');dispatchEvent(new PopStateEvent('popstate'))}}>← Voltar para clientes</button>

    <header className="dossier-head surface-dark">
      <span className="dossier-eyebrow">CLIENTE</span>
      <h1 className="dossier-name" data-surface-role="primary">{client.name}</h1>
      <p className="dossier-since" data-surface-role="secondary">{commercial.first_purchase?`Cliente desde ${monthYearLabel(commercial.first_purchase)}`:'Ainda sem compras registradas'}</p>
      <div className="dossier-stats">
        <div><strong data-surface-role="metric">{integer(Number(commercial.purchases))}</strong><span>compras</span></div>
        <div><strong data-surface-role="metric">{brl(Number(commercial.total_purchased))}</strong><span>comprados</span></div>
        <div><strong data-surface-role="metric">{Number(commercial.total_ml).toLocaleString('pt-BR')}</strong><span>ml</span></div>
      </div>
      <div className="dossier-actions">
        <SecondaryButton onClick={()=>setEditing(true)}>Editar cadastro</SecondaryButton>
        <span className="badge paid">{operationalLabel(client.status)}</span>
      </div>
    </header>

    {missingFields.length>0&&<Alert tone="warning" title="CADASTRO DE ENVIO INCOMPLETO">
      Antes de preparar um envio para este cliente, complete os dados abaixo: {missingFields.map(field=>`• ${field}`).join('  ')}. <SecondaryButton onClick={()=>setEditing(true)}>Completar cadastro</SecondaryButton>
    </Alert>}

    <Divider label="Dados da cliente"/>
    <section className="dossier-columns">
      <DefinitionGroup title="Contato" items={[
        {label:'Telefone',value:client.phone||'—'},
        {label:'WhatsApp',value:client.whatsapp_phone||'—'},
        {label:'E-mail',value:client.email||'—'},
        {label:'Instagram',value:client.instagram||'—'},
      ]}/>
      <DefinitionGroup title="Documentos" items={[
        {label:'CPF',value:client.cpf||'—'},
        {label:'CNPJ',value:client.cnpj||'—'},
        {label:'Nascimento',value:client.birth_date?shortDate(client.birth_date):'—'},
      ]}/>
      <DefinitionGroup title="Endereço" items={[
        {label:'CEP',value:client.postal_code||'—'},
        {label:'Endereço',value:[client.address_line,client.address_number].filter(Boolean).join(', ')||'—'},
        {label:'Complemento',value:client.complement||'—'},
        {label:'Bairro',value:client.district||'—'},
        {label:'Cidade/UF',value:[client.city,client.state].filter(Boolean).join(' / ')||'—'},
      ]}/>
    </section>

    <Divider label="Resumo comercial"/>
    <section className="dossier-columns">
      <DefinitionGroup title="Financeiro" items={[
        {label:'Total comprado',value:brl(Number(commercial.total_purchased))},
        {label:'Total pago',value:brl(Number(commercial.paid))},
        {label:'Total pendente',value:brl(Number(commercial.pending))},
        {label:'Crédito',value:brl(Number(commercial.credit))},
        {label:'Ticket médio',value:brl(Number(commercial.average_ticket))},
      ]}/>
      <DefinitionGroup title="Relacionamento" items={[
        {label:'Quantidade de compras',value:integer(Number(commercial.purchases))},
        {label:'Total ML',value:`${Number(commercial.total_ml).toLocaleString('pt-BR')} ML`},
        {label:'Perfume favorito',value:commercial.top_perfume||'—'},
        {label:'Primeira compra',value:commercial.first_purchase?shortDate(commercial.first_purchase):'—'},
        {label:'Última compra',value:commercial.last_purchase?shortDate(commercial.last_purchase):'—'},
      ]}/>
    </section>

    {error&&<div className="notice"><AlertTriangle/><span>{error}</span></div>}

    <Divider label="Portal / Custódia"/>
    <ClientPortalCard clientId={clientId} defaultEmail={client.email??''} phone={client.whatsapp_phone||client.phone||''}/>

    <Divider label="Produtos aguardando envio"/>
    <SectionHeader title={`${integer(waitingSorted.length)} ${waitingSorted.length===1?'produto':'produtos'} na RUAH`} description="Selecione as compras que devem sair juntas em um único envio." action={
      waitingSorted.length>0?<PrimaryButton disabled={!selected.length||preparing||missingFields.length>0} loading={preparing} onClick={prepare}>{selected.length?`Preparar envio com ${selected.length} ${selected.length===1?'produto':'produtos'}`:'Preparar envio'}</PrimaryButton>:undefined
    }/>
    {waitingSorted.length>0&&selected.length>0&&missingFields.length>0&&<Alert tone="warning" title="NÃO É POSSÍVEL CRIAR O ENVIO AINDA">
      Complete os dados do cliente: {missingFields.map(field=>`• ${field}`).join('  ')}. <SecondaryButton onClick={()=>setEditing(true)}>Completar cadastro</SecondaryButton>
    </Alert>}
    {waitingSorted.length===0?<EmptyState icon={Boxes} title="Nenhum produto confirmado para envio" description="Confirme o produto em custódia na Venda 360 correspondente para que ele apareça aqui, pronto para ser incluído em um envio."/>:
    <div className="card clients-table"><div className="table-wrap"><table><thead><tr><th>Nº</th><th></th><th>Venda</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Origem</th><th>Guardado há</th></tr></thead><tbody>{waitingSorted.map((item,index)=><tr key={item.allocation_id}><td className="row-number">{String(index+1).padStart(2,'0')}</td><td><input type="checkbox" checked={selected.includes(item.allocation_id)} onChange={(event)=>setSelected((current)=>event.target.checked?[...current,item.allocation_id]:current.filter((id)=>id!==item.allocation_id))}/></td><td>{shortDate(item.sale_date)}</td><td><strong>{item.perfume}</strong></td><td>{item.sale_type}</td><td>{Number(item.quantity_ml).toLocaleString('pt-BR')} ML</td><td>{brl(Number(item.amount))}</td><td><span className={`badge ${item.stock_managed?'paid':'pending'}`}>{item.stock_managed?'ESTOQUE OPERACIONAL':'CONFERIDO MANUALMENTE'}</span>{item.storage_location&&<small>{item.storage_location}</small>}</td><td>{item.days_waiting} dias</td></tr>)}</tbody></table></div></div>}

    <Divider label="Entregas da cliente"/>
    <SectionHeader title="Envios atuais" description={currentShipments.length?undefined:'Nenhum envio em andamento no momento.'}/>
    {currentShipments.length>0&&<div className="shipment-card-list">
      {currentShipments.map((shipment)=>{
        const items=(shipment.shipment_items as unknown as {sale_id:string;quantity_ml:number;sales?:{perfume_name_raw:string|null}|{perfume_name_raw:string|null}[]|null}[]|undefined)??[]
        const perfumeNames=items.map((item)=>Array.isArray(item.sales)?item.sales[0]?.perfume_name_raw:item.sales?.perfume_name_raw).filter(Boolean)
        return <article className="shipment-card" key={String(shipment.id)}>
          <div className="shipment-card-head">
            <div><strong>Envio #{String(shipment.id).slice(0,8).toUpperCase()}</strong><span>{items.length>1?`${integer(items.length)} compras enviadas juntas`:`${integer(items.length)} produto`}</span></div>
            <a className="ui-btn ui-btn--tertiary button-link" href={`/entregas/${shipment.id}`}>Abrir envio</a>
          </div>
          {items.length>1&&<p className="shipment-card-items">{perfumeNames.join(' · ')}</p>}
          <Stepper steps={JOURNEY_STEPS} currentIndex={journeyIndex(String(shipment.status))} compact/>
          <div className="shipment-card-foot">
            <span>{operationalLabel(shipment.status)}</span>
            {shipment.carrier&&<span>{String(shipment.carrier)}{shipment.shipping_price?` · ${brl(Number(shipment.shipping_price))}`:''}</span>}
            {shipment.tracking_code&&<span>Rastreio: {String(shipment.tracking_code)}</span>}
          </div>
        </article>
      })}
    </div>}

    {historicalShipments.length>0&&<>
      <SectionHeader title="Histórico de envios" description="Envios entregues ou cancelados."/>
      <div className="shipment-card-list">
        {historicalShipments.map((shipment)=>{
          const items=(shipment.shipment_items as unknown[]|undefined)??[]
          return <article className="shipment-card shipment-card--done" key={String(shipment.id)}>
            <div className="shipment-card-head">
              <div><strong>Envio #{String(shipment.id).slice(0,8).toUpperCase()}</strong><span>{integer(items.length)} {items.length===1?'produto':'produtos'}</span></div>
              <a className="ui-btn ui-btn--tertiary button-link" href={`/entregas/${shipment.id}`}>Abrir envio</a>
            </div>
            <div className="shipment-card-foot">
              <span>{shipment.status==='delivered'?`✓ Entregue${shipment.delivered_at?` em ${new Date(String(shipment.delivered_at)).toLocaleDateString('pt-BR')}`:''}`:operationalLabel(shipment.status)}</span>
              {shipment.tracking_code&&<span>Rastreio: {String(shipment.tracking_code)}</span>}
            </div>
          </article>
        })}
      </div>
    </>}

    <SectionHeader title="Logística legada" description="Histórico anterior à operação de envios; não representa allocations operacionais."/>
    <div className="card clients-table"><div className="table-wrap"><table><thead><tr><th>Compra</th><th>Perfume</th><th>Prazo previsto</th><th>Data de envio</th><th>Status histórico</th><th>Dias até envio</th><th>Prazo</th><th>Ação</th></tr></thead><tbody>{visibleHistory.map((sale)=>{const days=sale.sale_date&&sale.shipped_at?Math.round((new Date(String(sale.shipped_at)).valueOf()-new Date(String(sale.sale_date)).valueOf())/86400000):null,deadline=sale.shipping_deadline_date?String(sale.shipping_deadline_date):null;return <tr key={`log-${String(sale.id)}`}><td>{sale.sale_date?shortDate(String(sale.sale_date)):'—'}</td><td><strong>{String(sale.perfume_name_raw??'—')}</strong></td><td>{deadline?shortDate(deadline):String(sale.shipping_deadline_raw??'—')}</td><td>{sale.shipped_at?shortDate(String(sale.shipped_at)):'—'}</td><td>{String(sale.shipping_operational_status??(sale.shipped_at?'Enviado':'Sem status'))}</td><td>{days===null?'—':`${days} dias`}</td><td>{deadline&&sale.shipped_at?(String(sale.shipped_at)<=deadline?'Dentro do prazo':'Atrasado'):'—'}</td><td><button onClick={()=>setPurchase(sale as Record<string,unknown>)}>Ver compra</button></td></tr>})}</tbody></table>{visibleHistory.length===0&&<div className="inline-empty">Nenhum registro histórico.</div>}</div></div>

    <Divider label="Histórico de compras"/>
    <SectionHeader title={`${integer(visibleHistory.length)} de ${integer(data.history.length)} registros`} action={
      <SecondaryButton icon={<Filter size={16}/>} onClick={()=>setFiltersOpen(true)}>{activeHistoryFilterCount>0?`Filtros (${activeHistoryFilterCount})`:'Filtros'}</SecondaryButton>
    }/>
    <Drawer open={filtersOpen} onClose={()=>setFiltersOpen(false)} side="right" aria-label="Filtros do histórico de compras">
      <div className="history-filters-drawer">
        <h3>Filtros</h3>
        <label className="field"><span>Perfume</span><input value={historySearch} onChange={(event)=>setHistorySearch(event.target.value)} placeholder="Filtrar perfume…"/></label>
        <label className="field"><span>Início</span><input type="date" value={historyStart} onChange={(event)=>setHistoryStart(event.target.value)}/></label>
        <label className="field"><span>Fim</span><input type="date" value={historyEnd} onChange={(event)=>setHistoryEnd(event.target.value)}/></label>
        <label className="field"><span>Pagamento</span><select value={historyPayment} onChange={(event)=>setHistoryPayment(event.target.value)}><option value="">Todos os pagamentos</option><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Revisão</option></select></label>
        <label className="field"><span>Tipo</span><select value={historyType} onChange={(event)=>setHistoryType(event.target.value)}><option value="">APC e SPLIT</option><option>APC</option><option>SPLIT</option></select></label>
        <label className="field"><span>Envio</span><select value={historyShipping} onChange={(event)=>setHistoryShipping(event.target.value)}><option value="">Enviado e guardado</option><option value="shipped">Enviado</option><option value="waiting">Não enviado</option></select></label>
        <div className="history-filters-actions">
          {activeHistoryFilterCount>0&&<SecondaryButton onClick={clearHistoryFilters}>Limpar filtros</SecondaryButton>}
          <PrimaryButton onClick={()=>setFiltersOpen(false)}>Aplicar</PrimaryButton>
        </div>
      </div>
    </Drawer>
    {visibleHistory.length===0?<EmptyState icon={ShoppingBag} title="Nenhuma compra encontrada" description="Ajuste os filtros para ver o histórico completo desta cliente."/>:
    <div className="card clients-table"><div className="table-wrap"><table><thead><tr><th>Data</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Envio</th><th>Ação</th></tr></thead><tbody>{visibleHistory.map((sale)=>{const shipment=(sale.shipment_items as {shipments?:{status?:string;tracking_code?:string}}[]|undefined)?.[0]?.shipments;return <tr key={String(sale.id)}><td>{sale.sale_date?shortDate(String(sale.sale_date)):'—'}</td><td><strong>{String(sale.perfume_name_raw??'—')}</strong></td><td>{String(sale.sale_type??'—')}</td><td>{sale.volume_ml===null?'—':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ML`}</td><td>{brl(Number(sale.amount))}</td><td><span className={`badge ${sale.payment_status}`}>{statusLabel[String(sale.payment_status)]}</span></td><td>{shipment?.status?operationalLabel(shipment.status):(sale.shipped_at?shortDate(String(sale.shipped_at)):'Sem registro')}</td><td><button onClick={()=>setPurchase(sale as Record<string,unknown>)}>Ver compra</button></td></tr>})}</tbody></table></div></div>}
  </div>
}
