import {audit,context,json} from '../_shared/security.ts'
import {digits,extractOrderState,numberValue,providerValidation,safeProviderError,superFreteRequest,validDocument,validPhone} from '../_shared/superfrete.ts'
import {checkoutPayload,emissionAction} from '../_shared/superfrete-domain.ts'

const uuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value??''))?String(value):''
const present=(value:unknown)=>String(value??'').trim().length>0

Deno.serve(async(req)=>{
  const ctx=await context(req);if('response'in ctx)return ctx.response
  const {data:canLabel,error:permissionError}=await ctx.client.rpc('has_org_permission',{org_id:ctx.organizationId,permission_code:'shipping.label'})
  if(permissionError||!canLabel)return json({error:{code:'forbidden',message:'Seu acesso não permite emitir etiquetas.'}},403,req)
  const shipmentId=uuid(ctx.body.shipment_id)
  const requestedAction=String(ctx.body.action??'cart')
  if(!shipmentId)return json({error:{code:'invalid_shipment',message:'Envio inválido.'}},400,req)

  const {data:initial,error:initialError}=await ctx.client.from('shipments').select('id,superfrete_order_id,checkout_status').eq('id',shipmentId).eq('organization_id',ctx.organizationId).single()
  if(initialError||!initial)return json({error:{code:'shipment_not_found',message:'Envio não encontrado.'}},404,req)
  // Correção final (ordenação SuperFrete / conferência física): cart e
  // checkout são as duas ações que criam/comprometem algo do lado da
  // SuperFrete — a primeira ação externa real do fluxo. O gate de
  // conferência física precisa valer ANTES de qualquer uma das duas, não
  // só no post_shipment (defensivo, tardio demais para evitar o
  // descompasso "SuperFrete já avançou, nossa conferência não"). Reaproveita
  // exatamente a mesma consulta/formato de erro que já existia aqui para
  // checked_at/divergence_note — só acrescenta bottle_id/split_unit_id ao
  // select e mais uma condição de bloqueio, mesmo shape de resposta 409.
  const {data:conference}=await ctx.client.from('shipment_items').select('checked_at,divergence_note,bottle_id,split_unit_id,inventory_allocations(stock_managed,inventory_items(bottle_tracking_status)),sales(payment_status,split_completed_at,sale_type)').eq('shipment_id',shipmentId).is('removed_at',null)
  const unpaid=conference?.some(item=>(item.sales as {payment_status?:string}|null)?.payment_status!=='paid')
  if(unpaid)return json({error:{code:'payment_incomplete',message:'Todos os produtos precisam estar pagos antes da emissão.'}},409,req)
  const splitPending=conference?.some(item=>{const sale=item.sales as {sale_type?:string;split_completed_at?:string|null}|null;return ['SPLIT','APC'].includes(String(sale?.sale_type||'').toUpperCase())&&!sale?.split_completed_at})
  if(splitPending)return json({error:{code:'split_incomplete',message:'Finalize a separação de todos os itens SPLIT/APC antes da emissão.'}},409,req)
  if(!conference?.length||conference.some(item=>!item.checked_at||present(item.divergence_note)))return json({error:{code:'conference_incomplete',message:'Conferência incompleta. Confira todos os itens e resolva as divergências antes da emissão.'}},409,req)
  const missingPhysicalSource=conference.some(item=>{
    const allocation=item.inventory_allocations as {stock_managed?:boolean;inventory_items?:{bottle_tracking_status?:string}|null}|null
    const tracked=Boolean(allocation?.stock_managed)&&allocation?.inventory_items?.bottle_tracking_status==='active'
    return tracked&&!item.bottle_id&&!item.split_unit_id
  })
  if(missingPhysicalSource)return json({error:{code:'physical_source_not_confirmed',message:'Bipe o frasco ou o split de cada item com identidade física antes de emitir a etiqueta.'}},409,req)
  const initialAction=emissionAction(initial.superfrete_order_id,initial.checkout_status)
  if(initialAction==='blocked_uncertain'||initialAction==='sync_existing'){
    return json({error:{code:'reconciliation_required',message:'Já existe um pedido SuperFrete. Sincronize o envio; o carrinho não será repetido.'}},409,req)
  }

  let orderId=String(initial.superfrete_order_id||'')
  if(initialAction==='create_cart'){
    const {data:claim,error:claimError}=await ctx.client.rpc('claim_superfrete_cart',{p_shipment_id:shipmentId,p_idempotency_key:`${shipmentId}:cart:v1`})
    if(claimError)return json({error:{code:'label_not_ready',message:claimError.message}},409,req)
    if(!claim?.claimed)return json({error:{code:String(claim?.reason||'request_not_claimed'),message:'A emissão já foi iniciada ou precisa de reconciliação.'},details:claim},409,req)
    const cartRunId=String(claim.run_id)
    const [{data:shipment,error},{data:settings},{data:items}]=await Promise.all([
      ctx.client.from('shipments').select('*').eq('id',shipmentId).eq('organization_id',ctx.organizationId).single(),
      ctx.client.from('organization_shipping_settings').select('*').eq('organization_id',ctx.organizationId).maybeSingle(),
      ctx.client.from('shipment_items').select('quantity_ml,sales(id,amount,sale_type,perfume_name_raw,perfumes(full_name_raw))').eq('shipment_id',shipmentId).is('removed_at',null),
    ])
    const senderRequired=['sender_name','sender_document','sender_email','sender_phone','sender_postal_code','sender_address','sender_number','sender_district','sender_city','sender_state']
    const missingSender=senderRequired.filter(key=>!present((settings as Record<string,unknown>|null)?.[key]))
    const recipientMissing=[['recipient_name','nome'],['recipient_document','CPF/CNPJ'],['recipient_phone','telefone'],['recipient_postal_code','CEP'],['recipient_address','endereço'],['recipient_number','número'],['recipient_district','bairro'],['recipient_city','cidade'],['recipient_state','UF']].filter(([key])=>!present(shipment?.[key])).map(([,label])=>label)
    const invalidProduct=Boolean(items?.some((row:Record<string,unknown>)=>numberValue((row.sales as Record<string,unknown>|null)?.amount)<=0))
    const invalidPackage=!([shipment?.package_weight,shipment?.package_height,shipment?.package_width,shipment?.package_length].every(value=>numberValue(value)>0))
    if(error||!shipment||!settings||!items?.length||missingSender.length||recipientMissing.length||digits(settings.sender_postal_code).length!==8||digits(shipment?.recipient_postal_code).length!==8||!validDocument(settings?.sender_document)||!validDocument(shipment?.recipient_document)||!validPhone(settings?.sender_phone)||!validPhone(shipment?.recipient_phone)||invalidProduct||invalidPackage||!present(shipment?.service_id)){
      await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:cartRunId,p_stage:'cart',p_outcome:'failed',p_code:'INCOMPLETE_DATA',p_safe_message:'Dados de remetente, destinatário ou produtos incompletos.'})
      const message=!validDocument(settings?.sender_document)?'CPF/CNPJ do remetente inválido.':!validDocument(shipment?.recipient_document)?'CPF/CNPJ do destinatário inválido.':!validPhone(settings?.sender_phone)?'Telefone do remetente inválido.':!validPhone(shipment?.recipient_phone)?'Telefone do destinatário inválido.':recipientMissing.length?`Complete o cadastro da cliente: ${recipientMissing.join(', ')}.`:missingSender.length?`Complete os dados do remetente: ${missingSender.join(', ')}.`:invalidProduct?'Existe produto sem valor válido.':invalidPackage?'Peso e dimensões precisam ser maiores que zero.':!present(shipment?.service_id)?'Calcule o frete novamente e selecione um serviço.':'Revise CEP, pacote e produtos antes da emissão.'
      return json({error:{code:'shipping_data_incomplete',message},missing_sender:missingSender,missing_recipient:recipientMissing},422,req)
    }
    const products=items.map((row:Record<string,unknown>)=>{
      const sale=row.sales as Record<string,unknown>,perfume=sale?.perfumes as Record<string,unknown>|null
      return {name:String(perfume?.full_name_raw||sale?.perfume_name_raw||'Perfume'),quantity:1,unitary_value:numberValue(sale?.amount)}
    })
    const options:Record<string,unknown>={own_hand:false,receipt:false,insurance_value:Number(shipment.declared_value||0),non_commercial:shipment.fiscal_mode!=='invoice'}
    if(shipment.fiscal_mode==='invoice'&&shipment.invoice_key)options.invoice={key:shipment.invoice_key}
    const cartPayload={service:Number(shipment.service_id),
      from:{name:settings.sender_name,document:digits(settings.sender_document),email:settings.sender_email,phone:digits(settings.sender_phone),
        postal_code:digits(settings.sender_postal_code),address:settings.sender_address,number:settings.sender_number,complement:settings.sender_complement||'',
        district:settings.sender_district,city:settings.sender_city,state_abbr:String(settings.sender_state).toUpperCase()},
      to:{name:shipment.recipient_name,document:digits(shipment.recipient_document),email:shipment.recipient_email,phone:digits(shipment.recipient_phone),
        postal_code:digits(shipment.recipient_postal_code),address:shipment.recipient_address,number:shipment.recipient_number,complement:shipment.recipient_complement||'',
        district:shipment.recipient_district,city:shipment.recipient_city,state_abbr:String(shipment.recipient_state).toUpperCase()},
      products,volumes:[{quantity:1,weight:Number(shipment.package_weight),height:Number(shipment.package_height),width:Number(shipment.package_width),length:Number(shipment.package_length)}],options}
    let cart:Record<string,unknown>
    try{cart=await superFreteRequest('/api/v0/cart',{method:'POST',body:JSON.stringify(cartPayload)},30000) as Record<string,unknown>}
    catch(cause){const safe=safeProviderError(cause),provider=providerValidation((cause as {providerBody?:unknown})?.providerBody);console.error(JSON.stringify({stage:'cart',upstream_status:(cause as {status?:number})?.status||null,upstream_message:provider.message,validation_errors:provider.validation_errors,payload_shape:{service_id:Number(shipment.service_id),package:{weight:Number(shipment.package_weight),height:Number(shipment.package_height),width:Number(shipment.package_width),length:Number(shipment.package_length)},recipient:{has_name:present(shipment.recipient_name),has_document:validDocument(shipment.recipient_document),has_phone:validPhone(shipment.recipient_phone),has_postal_code:digits(shipment.recipient_postal_code).length===8,has_address:present(shipment.recipient_address),has_number:present(shipment.recipient_number),has_district:present(shipment.recipient_district),has_city:present(shipment.recipient_city),has_state:present(shipment.recipient_state)}}}));await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:cartRunId,p_stage:'cart',p_outcome:safe.uncertain?'uncertain':'failed',p_code:safe.code,p_safe_message:provider.message});return json({error:{code:'SUPERFRETE_VALIDATION_ERROR',message:provider.message,validation_errors:provider.validation_errors}},(cause as {status?:number})?.status===400?422:safe.httpStatus,req)}
    const cartState=extractOrderState(cart);orderId=String(cart.id||cartState.id||'')
    if(!orderId){await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:cartRunId,p_stage:'cart',p_outcome:'uncertain',p_code:'CART_ID_MISSING',p_safe_message:'A SuperFrete respondeu, mas o identificador do pedido não pôde ser confirmado.'});return json({error:{code:'reconciliation_required',message:'A resposta do carrinho precisa de reconciliação antes de qualquer nova tentativa.'}},409,req)}
    const {error:completeError}=await ctx.client.rpc('complete_superfrete_cart',{p_shipment_id:shipmentId,p_run_id:cartRunId,p_order_id:orderId,p_protocol:String(cart.protocol||cartState.protocol||''),p_price:numberValue(cart.price||cartState.price)})
    if(completeError){await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:cartRunId,p_stage:'cart',p_outcome:'uncertain',p_code:'CART_PERSIST_FAILED',p_safe_message:'O carrinho pode ter sido criado, mas não foi possível persistir sua confirmação.'});return json({error:{code:'reconciliation_required',message:'O carrinho pode existir na SuperFrete. Não tente novamente automaticamente.'}},409,req)}
  }

  if(requestedAction!=='checkout')return json({data:{cart_created:true,order_id:orderId,requires_checkout_confirmation:true}},200,req)

  const {data:checkoutClaim,error:checkoutClaimError}=await ctx.client.rpc('claim_superfrete_checkout',{p_shipment_id:shipmentId})
  if(checkoutClaimError||!checkoutClaim?.claimed)return json({error:{code:String(checkoutClaim?.reason||'checkout_not_ready'),message:'O checkout não pode ser repetido automaticamente. Sincronize o envio.'}},409,req)
  const checkoutRunId=String(checkoutClaim.run_id)
  let checkout:unknown
  try{checkout=await superFreteRequest('/api/v0/checkout',{method:'POST',body:JSON.stringify(checkoutPayload(String(checkoutClaim.order_id)))},30000)}
  catch(cause){const safe=safeProviderError(cause);await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:checkoutRunId,p_stage:'checkout',p_outcome:safe.uncertain?'uncertain':'failed',p_code:safe.code,p_safe_message:safe.message});return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)}
  let state=extractOrderState(checkout)
  if(!present(state.status)){
    try{state=extractOrderState(await superFreteRequest(`/api/v0/order/info/${encodeURIComponent(orderId)}`,{method:'GET'}))}
    catch(cause){const safe=safeProviderError(cause);await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:checkoutRunId,p_stage:'checkout',p_outcome:'uncertain',p_code:safe.code,p_safe_message:'O checkout respondeu, mas o estado final ainda não pôde ser confirmado.'});return json({error:{code:'reconciliation_required',message:'O checkout pode ter sido concluído. Sincronize o pedido antes de qualquer nova tentativa.'}},409,req)}
  }
  const {data,error:applyError}=await ctx.client.rpc('apply_superfrete_state',{p_shipment_id:shipmentId,p_run_id:checkoutRunId,p_state:state})
  if(applyError){await ctx.client.rpc('mark_superfrete_operation',{p_shipment_id:shipmentId,p_run_id:checkoutRunId,p_stage:'checkout',p_outcome:'uncertain',p_code:'CHECKOUT_PERSIST_FAILED',p_safe_message:'O checkout respondeu, mas não foi possível persistir seu estado.'});return json({error:{code:'reconciliation_required',message:'O checkout pode ter sido concluído. Sincronize antes de tentar novamente.'}},409,req)}
  await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_label_created','shipment',shipmentId,{order_id:orderId})
  return json({data},200,req)
})
