import{createClient}from'https://esm.sh/@supabase/supabase-js@2'
import{constantTimeEqual,firstName,formatBrl,normalizeBrazilianPhone}from'../_shared/manychat.ts'

const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
Deno.serve(async(req)=>{
  if(req.method!=='POST')return respond({ok:false,error:'method_not_allowed'},405)
  const expected=Deno.env.get('MANYCHAT_RUAH_WEBHOOK_SECRET')??'',received=req.headers.get('x-ruah-webhook-secret')??''
  if(!expected||!received||!constantTimeEqual(expected,received))return respond({ok:false,error:'unauthorized'},401)
  let body:Record<string,unknown>;try{body=await req.json()}catch{return respond({ok:false,error:'invalid_json'},400)}
  const phone=normalizeBrazilianPhone(body.phone)
  if(!phone)return respond({ok:false,error:'invalid_phone'},422)
  const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),organizationId=Deno.env.get('RUAH_ORGANIZATION_ID')
  if(!url||!serviceKey||!organizationId)return respond({ok:false,error:'server_config'},500)
  const admin=createClient(url,serviceKey)
  const{data,error}=await admin.rpc('whatsapp_customer_balance_v1',{p_organization_id:organizationId,p_normalized_phone:phone.slice(1)})
  if(error){console.error({event:'whatsapp_balance_failed',code:'balance_query_failed'});return respond({ok:false,error:'balance_unavailable'},503)}
  if(data?.status==='not_found')return respond({ok:false,error:'customer_not_found'},404)
  if(data?.status==='ambiguous')return respond({ok:false,error:'ambiguous_phone'},409)
  if(data?.status!=='ok')return respond({ok:false,error:'invalid_phone'},422)
  const total=Number(data.total_pending??0)
  return respond({ok:true,customer_name:firstName(String(data.customer_name??'')),open_orders:Number(data.open_orders??0),total_pending:total,total_formatted:formatBrl(total)})
})
