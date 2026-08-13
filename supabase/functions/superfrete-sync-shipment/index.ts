import {audit,context,json} from '../_shared/security.ts'
import {extractOrderState,safeProviderError,superFreteRequest} from '../_shared/superfrete.ts'

Deno.serve(async(req)=>{
  const ctx=await context(req);if('response'in ctx)return ctx.response
  if(ctx.role==='viewer')return json({error:{code:'forbidden',message:'Perfil sem permissão.'}},403,req)
  const shipmentId=String(ctx.body.shipment_id??'')
  const {data:shipment,error}=await ctx.client.from('shipments').select('id,superfrete_order_id').eq('id',shipmentId).eq('organization_id',ctx.organizationId).single()
  if(error||!shipment)return json({error:{code:'shipment_not_found',message:'Envio não encontrado.'}},404,req)
  if(!shipment.superfrete_order_id)return json({error:{code:'order_not_created',message:'Este envio ainda não possui pedido na SuperFrete.'}},409,req)
  try{
    const provider=await superFreteRequest(`/api/v0/order/info/${encodeURIComponent(shipment.superfrete_order_id)}`,{method:'GET'})
    const state=extractOrderState(provider)
    const {data,error:applyError}=await ctx.client.rpc('apply_superfrete_state',{p_shipment_id:shipmentId,p_run_id:null,p_state:state})
    if(applyError)throw new Error(applyError.message)
    const print=(state.print&&typeof state.print==='object'?state.print:{}) as Record<string,unknown>,printUrl=String(print.url??state.print_url??'')
    let printStatus:number|null=null,printType:string|null=null,printAvailable=false
    if(printUrl&&['released','posted','delivered'].includes(String(state.status??'').toLowerCase())){
      try{const url=new URL(printUrl);if(url.protocol==='https:'&&url.hostname==='etiqueta.superfrete.com'){const response=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(15_000)});printStatus=response.status;printType=response.headers.get('content-type');printAvailable=response.ok&&String(printType??'').toLowerCase().includes('application/pdf');await response.body?.cancel()}}catch{/* indisponibilidade externa registrada abaixo */}
    }
    await ctx.client.from('shipments').update({print_available:printAvailable,print_http_status:printStatus,print_content_type:printType,print_checked_at:new Date().toISOString(),integration_error:printUrl&&!printAvailable&&['released','posted','delivered'].includes(String(state.status??'').toLowerCase())?'SUPERFRETE_PRINT_UNAVAILABLE':null}).eq('id',shipmentId).eq('organization_id',ctx.organizationId)
    console.log(JSON.stringify({stage:'print_health',shipment_id:shipmentId,order_id_suffix:String(shipment.superfrete_order_id).slice(-6),external_status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(printUrl),print_url_host:printUrl?new URL(printUrl).hostname:null,print_url_path:printUrl?new URL(printUrl).pathname:null,print_http_status:printStatus,print_content_type:printType,print_available:printAvailable}))
    await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_sync','shipment',shipmentId,{status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(printUrl),print_http_status:printStatus,print_available:printAvailable})
    return json({data},200,req)
  }catch(cause){const safe=safeProviderError(cause);return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)}
})
