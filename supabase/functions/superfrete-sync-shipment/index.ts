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
    await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_sync','shipment',shipmentId,{status:state.status??null})
    return json({data},200,req)
  }catch(cause){const safe=safeProviderError(cause);return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)}
})
