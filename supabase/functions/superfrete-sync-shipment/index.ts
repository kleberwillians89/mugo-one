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

  // Etapa 1 — a chamada de rede de verdade. Só um erro AQUI significa
  // realmente "a SuperFrete não confirmou" (timeout/HTTP/DNS/resposta
  // ilegível). Um erro DEPOIS desta etapa nunca deve reusar essa mensagem:
  // a SuperFrete já respondeu com sucesso, quem falhou foi o RUAH ao
  // processar a resposta localmente — ver etapas 2 e 3 abaixo.
  let provider:unknown
  try{
    provider=await superFreteRequest(`/api/v0/order/info/${encodeURIComponent(shipment.superfrete_order_id)}`,{method:'GET'})
  }catch(cause){
    const safe=safeProviderError(cause)
    return json({error:{code:safe.code,message:safe.message}},safe.httpStatus,req)
  }
  const state=extractOrderState(provider)

  // Etapa 2 — aplicar o estado JÁ confirmado pela SuperFrete no banco
  // local. Correção final: a SuperFrete já reportou um estado externo que
  // exigiria postar localmente, mas o gate defensivo de post_shipment
  // bloqueou por falta de conferência física (frasco/split) — nunca
  // silenciar isso como um erro genérico de sincronização. Persiste em
  // integration_error (a mesma coluna já exibida na tela de envio via
  // friendlyIntegrationError) para virar um estado operacional visível e
  // recuperável, não um erro que desaparece com a resposta HTTP. Nada
  // aqui inventa/força bottle_id nem contorna o gate — só torna o
  // "aguardando conferência" visível; sincronizar de novo depois do bipe
  // válido é idempotente (post_shipment já retorna cedo se o envio já
  // estiver postado, e não faz nada até a conferência existir). Qualquer
  // OUTRA falha aqui (RLS, cast de campo secundário, etc.) é um problema
  // do RUAH em salvar um estado que a SuperFrete já confirmou — nunca
  // "erro de rede".
  const {error:applyError}=await ctx.client.rpc('apply_superfrete_state',{p_shipment_id:shipmentId,p_run_id:null,p_state:state})
  if(applyError){
    if(applyError.message.includes('physical_source_not_confirmed')){
      // Mesma correção do 42501 de baixo (print_health_persist): update
      // direto em shipments nunca teve GRANT para authenticated — passa
      // pela RPC estreita em vez do .update() direto.
      await ctx.client.rpc('shipment_mark_superfrete_pending_conference',{p_shipment_id:shipmentId})
      return json({error:{code:'physical_conference_pending',message:'A SuperFrete já avançou este envio, mas a conferência física (frasco ou split) ainda não foi feita. Bipe o item pendente e sincronize novamente.'}},409,req)
    }
    console.error(JSON.stringify({stage:'apply_superfrete_state',shipment_id:shipmentId,order_id_suffix:String(shipment.superfrete_order_id).slice(-6),db_error_code:applyError.code??null}))
    return json({error:{code:'SUPERFRETE_STATE_APPLY_ERROR',message:'A SuperFrete confirmou o pedido, mas o RUAH não conseguiu salvar o novo estado agora. Nada foi comprado ou postado de novo — sincronize novamente.'}},502,req)
  }

  // Etapa 3 — descobrir/persistir o status do arquivo de impressão. Também
  // isolada: um erro aqui significa que o estado principal (status,
  // rastreio) já foi salvo com sucesso na etapa 2; só a checagem do
  // arquivo é que não pôde ser concluída.
  try{
    const print=(state.print&&typeof state.print==='object'?state.print:{}) as Record<string,unknown>
    const rawPrintUrl=print.url??state.print_url??(typeof state.print==='string'?state.print:null)??shipment.print_url??shipment.label_pdf_url??''
    const trustedPrintUrl=officialPrintUrl(rawPrintUrl)?.href??''
    const printableStatus=['released','posted','delivered'].includes(String(state.status??'').toLowerCase())
    const probe=printableStatus?await probeOfficialPrintFile(rawPrintUrl):{available:false,httpStatus:null,contentType:null,reason:'missing_url' as const}
    const printError=!printableStatus?'SUPERFRETE_PROVIDER_PROCESSING':probe.available?null:probe.reason==='missing_url'?'SUPERFRETE_FILE_MISSING':probe.httpStatus===401||probe.httpStatus===403?'SUPERFRETE_FILE_AUTH_OR_EXPIRED':probe.reason==='not_pdf'&&String(probe.contentType).includes('text/html')?'SUPERFRETE_FILE_HTML':probe.reason==='invalid_url'||probe.reason==='untrusted_source'?'SUPERFRETE_FILE_INVALID_URL':'SUPERFRETE_FILE_EXTERNAL_ERROR'
    // Escritas em shipments passam só por RPC security definer (contrato do
    // projeto desde 202608130001 — authenticated não tem INSERT/UPDATE/
    // DELETE direto na tabela). Um UPDATE direto aqui é exatamente o que
    // causava 42501 em produção: o client usa o JWT do chamador (não
    // service_role), e a tabela nunca concedeu esse GRANT a "authenticated".
    const {data:updated,error:updateError}=await ctx.client.rpc('shipment_set_superfrete_print_health',{p_shipment_id:shipmentId,p_print_url:trustedPrintUrl||null,p_label_pdf_url:trustedPrintUrl||null,p_print_available:probe.available,p_print_http_status:probe.httpStatus,p_print_content_type:probe.contentType,p_integration_error:printError})
    if(updateError||!updated){
      console.error(JSON.stringify({stage:'print_health_persist',shipment_id:shipmentId,db_error_code:updateError?.code??'no_row'}))
      return json({error:{code:'SUPERFRETE_PRINT_PERSIST_ERROR',message:'O estado da SuperFrete foi sincronizado, mas o RUAH não conseguiu salvar o status de impressão agora. Sincronize novamente.'}},502,req)
    }
    let printHost:string|null=null,printPath:string|null=null
    try{const safeUrl=officialPrintUrl(rawPrintUrl);printHost=safeUrl?.hostname??null;printPath=safeUrl?.pathname??null}catch{/* URL externa inválida; nunca registrar o valor bruto */}
    console.log(JSON.stringify({stage:'print_health',shipment_id:shipmentId,order_id_suffix:String(shipment.superfrete_order_id).slice(-6),external_status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(rawPrintUrl),print_url_host:printHost,print_url_path:printPath,print_http_status:probe.httpStatus,print_content_type:probe.contentType,print_available:probe.available,print_probe_reason:probe.reason}))
    await audit(ctx.client,ctx.organizationId,ctx.user.id,'superfrete_sync','shipment',shipmentId,{status:state.status??null,has_tracking:Boolean(state.tracking),has_print_url:Boolean(rawPrintUrl),print_http_status:probe.httpStatus,print_available:probe.available,print_probe_reason:probe.reason})
    return json({data:updated},200,req)
  }catch(cause){
    // probeOfficialPrintFile nunca lança (captura os próprios erros); se
    // algo inesperado ainda assim escapar aqui, o estado principal da
    // etapa 2 já foi persistido com sucesso — nunca reusar o rótulo de
    // erro de rede do provedor para isto.
    console.error(JSON.stringify({stage:'print_health_unexpected',shipment_id:shipmentId,message:cause instanceof Error?cause.message:'unknown'}))
    return json({error:{code:'SUPERFRETE_PRINT_PERSIST_ERROR',message:'O estado da SuperFrete foi sincronizado, mas o RUAH não conseguiu concluir a checagem do arquivo de impressão. Sincronize novamente.'}},502,req)
  }
})
