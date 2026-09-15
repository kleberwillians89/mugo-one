import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, corsHeaders, json } from '../_shared/security.ts'

const uuid=/^[0-9a-f-]{36}$/i,max=15*1024*1024

Deno.serve(async req=>{
  const origin=req.headers.get('origin')??''
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req)})
  if(req.method!=='POST')return json({error:{code:'method_not_allowed',message:'Método não permitido.'}},405,req)
  if(!origin||!('access-control-allow-origin' in corsHeaders(req)))return json({error:{code:'origin_forbidden',message:'Origem não autorizada.'}},403,req)
  const authorization=req.headers.get('authorization'),url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!authorization?.startsWith('Bearer ')||!url||!anon||!serviceKey)return json({error:{code:'unauthorized',message:'Autenticação necessária.'}},401,req)
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),{data:{user}}=await client.auth.getUser()
  if(!user)return json({error:{code:'unauthorized',message:'Sessão inválida.'}},401,req)
  let form:FormData;try{form=await req.formData()}catch{return json({error:{code:'invalid_form',message:'Imagem inválida.'}},400,req)}
  const file=form.get('file'),organizationId=String(form.get('organization_id')??''),clientId=String(form.get('client_id')??'')
  let saleIds:string[]=[];try{saleIds=JSON.parse(String(form.get('sale_ids')??'[]'))}catch{return json({error:{code:'invalid_sales',message:'Pedidos inválidos.'}},400,req)}
  if(!(file instanceof File)||!uuid.test(organizationId)||!uuid.test(clientId)||!Array.isArray(saleIds)||!saleIds.length||saleIds.some(id=>!uuid.test(String(id))))return json({error:{code:'invalid_input',message:'Cliente, pedidos e imagem são obrigatórios.'}},400,req)
  if(!file.size||file.size>max||file.type!=='image/png')return json({error:{code:'invalid_image',message:'A imagem PNG deve ter no máximo 15 MB.'}},400,req)
  const signature=new Uint8Array(await file.slice(0,8).arrayBuffer())
  if(![137,80,78,71,13,10,26,10].every((value,index)=>signature[index]===value))return json({error:{code:'invalid_image',message:'O conteúdo enviado não é um PNG válido.'}},400,req)
  const[{data:membership},{data:allowed}]=await Promise.all([
    client.from('organization_members').select('organization_id').eq('organization_id',organizationId).eq('user_id',user.id).maybeSingle(),
    client.rpc('has_org_permission',{org_id:organizationId,permission_code:'sales.view'}),
  ])
  if(!membership||!allowed)return json({error:{code:'forbidden',message:'Você não tem permissão para preparar esta cobrança.'}},403,req)
  const admin=createClient(url,serviceKey),[{data:customer},{data:pending,error:pendingError}]=await Promise.all([
    admin.from('clients').select('id').eq('id',clientId).eq('organization_id',organizationId).is('deleted_at',null).is('merged_into_id',null).maybeSingle(),
    admin.rpc('collections_pending_sales_operational',{p_organization_id:organizationId}),
  ])
  const selected=(pending??[]).filter((row:Record<string,unknown>)=>row.client_id===clientId&&saleIds.includes(String(row.id)))
  if(!customer||pendingError||selected.length!==new Set(saleIds).size)return json({error:{code:'collection_changed',message:'A cobrança mudou. Atualize a página antes de enviar.'}},409,req)
  const path=`${organizationId}/${clientId}/${crypto.randomUUID()}.png`
  const uploaded=await admin.storage.from('collection-images').upload(path,file,{contentType:'image/png',upsert:false})
  if(uploaded.error)return json({error:{code:'upload_failed',message:'Não foi possível preparar a imagem da cobrança.'}},502,req)
  const signed=await admin.storage.from('collection-images').createSignedUrl(path,7*24*60*60)
  if(signed.error||!signed.data?.signedUrl){await admin.storage.from('collection-images').remove([path]);return json({error:{code:'signed_url_failed',message:'Não foi possível disponibilizar a imagem da cobrança.'}},502,req)}
  try{await audit(client,organizationId,user.id,'collection_image_prepared','client',clientId,{sale_count:saleIds.length})}catch{/* imagem permanece válida mesmo se auditoria auxiliar falhar */}
  return json({data:{url:signed.data.signedUrl}},201,req)
})
