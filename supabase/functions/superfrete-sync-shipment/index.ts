import {audit,context,json} from '../_shared/security.ts'
import {extractOrderState,safeProviderError,superFreteRequest} from '../_shared/superfrete.ts'
import {officialPrintUrl,probeOfficialPrintFile} from '../_shared/superfrete-print.ts'

Deno.serve(async(req)=>{
  const ctx=await context(req);if('response'in ctx)return ctx.response
  if(ctx.role==='viewer')return json({error:{code:'forbidden',message:'Perfil sem permissão.'}},403,req)
  const shipmentId=String(ctx.body.shipment_id??'')
  const {data:shipment,error}=await ctx.client.from('shipments').select('id,superfrete_order_id,print_url,label_pdf_url').eq('id',shipmentId).eq('organization_id',ctx.organizationId).single()
  if(error||!shipment)return json({error:{code:'shipment_not_found',message:'Envio não encontrado.'}},404,req)
  if(!shipment.superfrete_order_id)return json({error:{code:'order_not_created',message:'Este envio ainda não possui pedido na SuperFrete.'}},409,req)
  try{
    const provider=await superFreteRequest(`/api/v0/order/info/${encodeURIComponent(shipment.superfrete_order_id)}`,{method:'GET'})
    const state=extractOrderState(provider)
    const {error:applyError}=await ctx.client.rpc('apply_superfrete_state',{p_shipment_id:shipmentId,p_run_id:null,p_state:state})
    if(applyError)throw new Error(applyError.message)
    const print=(state.print&&typeof state.print==='object'?state.print:{}) as Record<string,unknown>
    const rawPrintUrl=print.url??state.print_url??(typeof state.print==='string'?state.print:null)??shipment.print_url??shipment.label_pdf_url??''
    const trustedPrintUrl=officialPrintUrl(rawPrintUrl)?.href??''
    const printableStatus=['released','posted','delivered'].includes(String(state.status??'').toLowerCase())
    const probe=printableStatus?await probeOfficialPrintFile(rawPrintUrl):{available:false,httpStatus:null,contentType:null,reason:'missing_url' as const}
    const printError=!printableStatus?'SUPERFRETE_PROVIDER_PROCESSING':probe.available?null:probe.reason==='missing_url'?'SUPERFRETE_FILE_MISSING':probe.httpStatus===401||probe.httpStatus===403?'SUPERFRETE_FILE_AUTH_OR_EXPIRED':probe.reason==='not_pdf'&&String(probe.contentType).includes('text/html')?'SUPERFRETE_FILE_HTML':probe.reason==='invalid_url'||probe.reason==='untrusted_source'?'SUPERFRETE_FILE_INVALID_URL':'SUPERFRETE_FILE_EXTERNAL_ERROR'
    const {data:updated,error:updateError}=await ctx.client.from('shipments').update({print_url:trustedPrintUrl||null,label_pdf_url:trustedPrintUrl||null,print_available:probe.available,print_http_status:probe.httpStatus,print_content_type:probe.contentType,print_checked_at:new Date().toISOString(),integration_error:printError}).eq('id',shipmentId).eq('organization_id',ctx.organizationId).select('*').single()
    if(updateError||!updated)throw new Error(`print_health_persist_failed:${updateError?.code||'no_row'}`)
    let printHost:string|null=null,printPath:string|null=null
    try{const safeUrl=officialPrintUrl(rawPrintUrl);printHost=safeUrl?.hostname??null;printPath=safeUrl?.pathname??null}catch{/* URL externa inválida; nunca registrar o valor bruto */}
    console.log(JSON.stringify({stage:'print_health',shipment_id:shipmentId,order_id_suffix:String(shipment.superfrete_order_id).slice(-6),external_status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(rawPrintUrl),print_url_host:printHost,print_url_path:printPath,print_http_status:probe.httpStatus,print_content_type:probe.contentType,print_available:probe.available,print_probe_reason:probe.reason}))
    await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_sync','shipment',shipmentId,{status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(rawPrintUrl),print_http_status:probe.httpStatus,print_available:probe.available,print_probe_reason:probe.reason})
    return json({data:updated},200,req)
  }catch(cause){const safe=safeProviderError(cause);return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)}
})
