import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, context, json } from '../_shared/security.ts'
import { ManychatApiError, MessageType, normalizeBrazilianPhone, sendManychatFlow, withInFlightKey } from '../_shared/manychat.ts'

Deno.serve(async(req)=>{
  const ctx=await context(req,{allowSingleOrganizationFallback:true});if('response'in ctx)return ctx.response
  const clientId=String(ctx.body.client_id??''),messageType=String(ctx.body.message_type??'') as MessageType
  if(!/^[0-9a-f-]{36}$/i.test(clientId)||!['collection','access'].includes(messageType))return json({error:{code:'invalid_input',message:'Cliente ou tipo de envio inválido.'}},400,req)
  const permission=messageType==='collection'?'sales.view':'clients.view'
  const{data:allowed,error:permissionError}=await ctx.client.rpc('has_org_permission',{org_id:ctx.organizationId,permission_code:permission})
  if(permissionError||!allowed)return json({error:{code:'forbidden',message:'Você não tem permissão para enviar esta mensagem.'}},403,req)
  const supabaseUrl=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const apiKey=Deno.env.get('MANYCHAT_API_KEY'),flowNs=Deno.env.get(messageType==='collection'?'MANYCHAT_COLLECTION_FLOW_ID':'MANYCHAT_ACCESS_FLOW_ID')
  if(!supabaseUrl||!serviceKey||!apiKey||!flowNs)return json({error:{code:'server_config',message:'Integração com WhatsApp não configurada.'}},500,req)
  const admin=createClient(supabaseUrl,serviceKey)
  const{data:customer,error:customerError}=await admin.from('clients').select('id,organization_id,name,phone,whatsapp_phone,normalized_phone,normalized_whatsapp').eq('id',clientId).eq('organization_id',ctx.organizationId).is('deleted_at',null).is('merged_into_id',null).maybeSingle()
  if(customerError||!customer)return json({error:{code:'client_not_found',message:'Cliente não encontrado.'}},404,req)
  const rawPhone=String(customer.whatsapp_phone??'').trim()||String(customer.phone??'').trim()
  const phone=normalizeBrazilianPhone(rawPhone)
  if(!phone)return json({error:{code:customer.whatsapp_phone||customer.phone?'invalid_phone':'phone_required',message:customer.whatsapp_phone||customer.phone?'O telefone cadastrado é inválido.':'Cadastre um telefone para enviar o WhatsApp.'}},422,req)
  const normalized=phone.slice(1)
  const{data:matches,error:matchError}=await admin.from('clients').select('id').eq('organization_id',ctx.organizationId).is('deleted_at',null).is('merged_into_id',null).or(`normalized_whatsapp.eq.${normalized},normalized_phone.eq.${normalized}`)
  if(matchError)return json({error:{code:'phone_lookup_failed',message:'Não foi possível validar o telefone.'}},500,req)
  const matchedIds=new Set((matches??[]).map(row=>row.id))
  if(matchedIds.size!==1||!matchedIds.has(clientId))return json({error:{code:'ambiguous_phone',message:'Este telefone está vinculado a mais de uma cliente. Revise o cadastro.'}},409,req)
  let customFields
  if(messageType==='collection'){
    const saleIds=Array.isArray(ctx.body.sale_ids)?[...new Set(ctx.body.sale_ids.map(String))]:[]
    if(!saleIds.length||saleIds.length>500||saleIds.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))return json({error:{code:'invalid_sales',message:'Os pedidos selecionados para cobrança são inválidos. Atualize a página.'}},400,req)
    const{data:pending,error:pendingError}=await admin.rpc('collections_pending_sales_operational',{p_organization_id:ctx.organizationId})
    if(pendingError)return json({error:{code:'collection_lookup_failed',message:'Não foi possível preparar os dados atuais da cobrança.'}},500,req)
    const selected=(pending??[]).filter((row:Record<string,unknown>)=>row.client_id===clientId&&saleIds.includes(String(row.id)))
    if(selected.length!==saleIds.length)return json({error:{code:'collection_changed',message:'A cobrança mudou desde que a página foi aberta. Atualize antes de enviar.'}},409,req)
    const value=selected.reduce((sum:number,row:Record<string,unknown>)=>sum+Number(row.amount??0),0)
    if(!Number.isFinite(value)||value<0)return json({error:{code:'invalid_order_value',message:'O valor atual da cobrança é inválido.'}},422,req)
    let imageUrl:string|undefined
    const candidate=String(ctx.body.imagem_cobranca_url??'').trim()
    if(candidate){
      try{const parsed=new URL(candidate),project=new URL(supabaseUrl);if(parsed.origin===project.origin&&parsed.pathname.startsWith('/storage/v1/object/sign/collection-images/'))imageUrl=parsed.toString()}catch{/* URL opcional inválida é ignorada */}
    }
    customFields={nome_cliente:customer.name,numero_pedido:saleIds.join(','),valor_pedido:Number(value.toFixed(2)),...(imageUrl?{imagem_cobranca_url:imageUrl}:{})}
  }
  try{
    await withInFlightKey(`${ctx.organizationId}:${clientId}:${messageType}`,async()=>{
      const result=await sendManychatFlow({apiKey,flowNs,phone,name:customer.name,customFields})
      try{await audit(ctx.client,ctx.organizationId,ctx.user.id,'manychat_flow_requested','client',clientId,{message_type:messageType,provider:'manychat',phone_last4:result.phone_last4})}catch(error){console.error({event:'manychat_audit_failed',client_id:clientId,message_type:messageType,error:String(error)})}
      return result
    })
    return json({data:{status:'sent',message_type:messageType}},200,req)
  }catch(error){
    const code=error instanceof ManychatApiError?error.code:'manychat_unavailable',status=error instanceof ManychatApiError?error.httpStatus:503
    const messages:Record<string,string>={manychat_token_invalid:'A autenticação do ManyChat foi recusada.',manychat_unavailable:'O ManyChat está indisponível. Tente novamente.',manychat_create_contact_failed:'O contato já pode existir no WhatsApp do ManyChat, mas não foi possível localizá-lo ou criá-lo.',manychat_lookup_failed:'Não foi possível localizar o contato no ManyChat.',manychat_custom_fields_lookup_failed:'Não foi possível consultar os campos personalizados do ManyChat.',manychat_custom_fields_missing:'Faltam campos personalizados obrigatórios no ManyChat.',manychat_value_field_type:'O campo de valor do pedido no ManyChat precisa ser do tipo Number.',manychat_invalid_order_value:'O valor da cobrança é inválido.',manychat_custom_fields_invalid:'O ManyChat devolveu campos personalizados inválidos.',manychat_custom_fields_update_failed:'Não foi possível atualizar os dados da cobrança no ManyChat; a automação não foi disparada.',manychat_flow_not_found:'O flow_ns configurado não existe entre as automações desta conta do ManyChat.',manychat_send_failed:'O ManyChat não conseguiu iniciar a automação.',manychat_invalid_subscriber:'O contato retornado pelo ManyChat é inválido.'}
    const providerStatus=error instanceof ManychatApiError?error.providerStatus:undefined,providerReason=error instanceof ManychatApiError?error.providerReason:undefined
    const providerHint=providerReason?` Motivo informado pelo ManyChat: ${providerReason}.`:''
    const flowHint=code==='manychat_send_failed'?' O flow_ns existe; confira se a automação está publicada e começa com um modelo WhatsApp aprovado.':''
    console.error('[manychat] flow_failed',{message_type:messageType,code,provider_status:providerStatus,provider_reason:providerReason})
    return json({error:{code,message:`${messages[code]??'Não foi possível enviar o WhatsApp.'}${providerHint}${flowHint}`,provider_status:providerStatus,provider_reason:providerReason}},status,req)
  }
})
