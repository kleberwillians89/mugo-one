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
  try{
    await withInFlightKey(`${ctx.organizationId}:${clientId}:${messageType}`,async()=>{
      const result=await sendManychatFlow({apiKey,flowNs,phone,name:customer.name})
      try{await audit(ctx.client,ctx.organizationId,ctx.user.id,'manychat_flow_requested','client',clientId,{message_type:messageType,provider:'manychat',phone_last4:result.phone_last4})}catch(error){console.error({event:'manychat_audit_failed',client_id:clientId,message_type:messageType,error:String(error)})}
      return result
    })
    return json({data:{status:'sent',message_type:messageType}},200,req)
  }catch(error){
    const code=error instanceof ManychatApiError?error.code:'manychat_unavailable',status=error instanceof ManychatApiError?error.httpStatus:503
    const messages:Record<string,string>={manychat_token_invalid:'A autenticação do ManyChat foi recusada.',manychat_unavailable:'O ManyChat está indisponível. Tente novamente.',manychat_create_contact_failed:'Não foi possível preparar o contato no ManyChat.',manychat_lookup_failed:'Não foi possível localizar o contato no ManyChat.',manychat_send_failed:'O ManyChat não conseguiu iniciar a automação.',manychat_invalid_subscriber:'O contato retornado pelo ManyChat é inválido.'}
    console.error({event:'manychat_send_failed',client_id:clientId,message_type:messageType,code})
    return json({error:{code,message:messages[code]??'Não foi possível enviar o WhatsApp.'}},status,req)
  }
})
