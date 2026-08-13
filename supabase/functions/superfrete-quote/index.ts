import {audit,context,json} from '../_shared/security.ts'
import {digits,normalizeQuote,safeProviderError,superFreteRequest} from '../_shared/superfrete.ts'

Deno.serve(async(req)=>{
  const ctx=await context(req);if('response'in ctx)return ctx.response
  if(ctx.role==='viewer')return json({error:{code:'forbidden',message:'Perfil sem permissão para cotar.'}},403,req)
  const shipmentId=String(ctx.body.shipment_id??'')
  const [{data:shipment,error},{data:settings}]=await Promise.all([
    ctx.client.from('shipments').select('*').eq('id',shipmentId).eq('organization_id',ctx.organizationId).single(),
    ctx.client.from('organization_shipping_settings').select('*').eq('organization_id',ctx.organizationId).maybeSingle(),
  ])
  if(error||!shipment)return json({error:{code:'shipment_not_found',message:'Envio não encontrado.'}},404,req)
  if(!settings)return json({error:{code:'sender_settings_missing',message:'Configure o remetente e o pacote padrão em Configurações → SuperFrete — Produção.'}},422,req)
  const origin=digits(settings?.sender_postal_code),destination=digits(shipment.recipient_postal_code)
  const weight=Number(shipment.package_weight||settings?.default_weight),height=Number(shipment.package_height||settings?.default_height)
  const width=Number(shipment.package_width||settings?.default_width),length=Number(shipment.package_length||settings?.default_length)
  const missing=[origin.length!==8?'CEP do remetente':null,destination.length!==8?'CEP do destinatário':null,!Number.isFinite(weight)||weight<=0?'peso':null,!Number.isFinite(height)||height<=0?'altura':null,!Number.isFinite(width)||width<=0?'largura':null,!Number.isFinite(length)||length<=0?'comprimento':null].filter(Boolean)
  if(missing.length)return json({error:{code:'shipping_data_incomplete',message:`Dados incompletos para cotação: ${missing.join(', ')}.`}},422,req)
  try{
    const provider=await superFreteRequest('/api/v0/calculator',{method:'POST',body:JSON.stringify({
      from:{postal_code:origin},to:{postal_code:destination},services:settings?.calculator_services||'1,2,17,3,31',
      options:{own_hand:false,receipt:false,insurance_value:Number(shipment.declared_value||0),use_insurance_value:Number(shipment.declared_value||0)>0},
      package:{weight,height,width,length},
    })})
    const quotes=(Array.isArray(provider)?provider:[]).map(item=>normalizeQuote(item as Record<string,unknown>)).filter(item=>item.service_id)
    const {data,error:saveError}=await ctx.client.rpc('save_superfrete_quotes',{p_shipment_id:shipmentId,p_quotes:quotes})
    if(saveError)throw new Error(saveError.message)
    await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_quote','shipment',shipmentId,{services_returned:quotes.length})
    return json({data},200,req)
  }catch(cause){const safe=safeProviderError(cause);return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)}
})
