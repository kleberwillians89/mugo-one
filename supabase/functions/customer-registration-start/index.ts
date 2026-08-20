import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {corsHeaders,json} from '../_shared/security.ts'
import {sendInviteEmail} from '../_shared/customer-invite.ts'

const allowed=new Set(['https://crmruahparfums.vercel.app','https://crm.ruahparfums.com.br','http://localhost:5173'])
const generic={data:{message:'Vamos confirmar seus dados para continuar. Se o cadastro puder prosseguir, você receberá um e-mail com o próximo passo.'}}
Deno.serve(async(req)=>{
  const origin=req.headers.get('origin');if(origin&&!allowed.has(origin))return json({error:{code:'origin_forbidden',message:'Origem não autorizada.'}},403,req)
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req)});if(req.method!=='POST')return json({},405,req)
  let body:Record<string,unknown>;try{body=await req.json()}catch{return json(generic,200,req)}
  const name=String(body.name??'').trim(),email=String(body.email??'').trim().toLowerCase(),phone=String(body.phone??'').replace(/\D/g,'')
  if(name.length<3||!email.includes('@')||phone.length<10)return json(generic,200,req)
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),org=Deno.env.get('RUAH_ORGANIZATION_ID')
  if(!url||!key||!org)return json({error:{code:'server_config',message:'Cadastro temporariamente indisponível.'}},503,req)
  const admin=createClient(url,key)
  const {data:generated,error}=await admin.auth.admin.generateLink({type:'invite',email,options:{redirectTo:`${Deno.env.get('RUAH_PORTAL_URL')??'https://crm.ruahparfums.com.br'}/minha-ruah/ativar`,data:{full_name:name,phone,ruah_public_registration:true}}})
  if(error||!generated.user||!generated.properties?.action_link)return json(generic,200,req)
  const {error:requestError}=await admin.from('customer_identity_requests').upsert({organization_id:org,auth_user_id:generated.user.id,full_name:name,email,phone,status:'email_pending'},{onConflict:'auth_user_id'})
  if(requestError)return json(generic,200,req)
  await sendInviteEmail({to:email,name,actionLink:generated.properties.action_link})
  await admin.from('audit_logs').insert({organization_id:org,actor_id:generated.user.id,action:'ACCOUNT_CREATED',entity_type:'customer_identity_request',entity_id:generated.user.id})
  return json(generic,200,req)
})
