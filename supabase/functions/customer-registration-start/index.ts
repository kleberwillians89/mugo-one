import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {corsHeaders,json} from '../_shared/security.ts'
import {sendInviteEmail} from '../_shared/customer-invite.ts'
import {firstAccessRedirectUrl,isAllowedPublicOrigin} from '../_shared/public-app-url.ts'

const generic={data:{message:'Vamos confirmar seus dados para continuar. Se o cadastro puder prosseguir, você receberá um e-mail com o próximo passo.'}}
const maskedEmail=(value:string)=>{const[local,domain]=value.split('@');return local&&domain?`${local[0]}***@${domain}`:'e-mail inválido'}
Deno.serve(async(req)=>{
  const origin=req.headers.get('origin');if(!isAllowedPublicOrigin(origin))return json({error:{code:'origin_forbidden',message:'Origem não autorizada.'}},403,req)
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req)});if(req.method!=='POST')return json({},405,req)
  let body:Record<string,unknown>;try{body=await req.json()}catch{return json(generic,200,req)}
  const name=String(body.name??'').trim(),email=String(body.email??'').trim().toLowerCase(),phone=String(body.phone??'').replace(/\D/g,'')
  console.log({event:'registration_start_received',email:maskedEmail(email),recipient_present:Boolean(email)})
  if(name.length<3||!email.includes('@')||phone.length<10)return json(generic,200,req)
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),org=Deno.env.get('RUAH_ORGANIZATION_ID')
  if(!url||!key||!org)return json({error:{code:'server_config',message:'Cadastro temporariamente indisponível.'}},503,req)
  const admin=createClient(url,key)
  console.log({event:'auth_link_generation_start',email:maskedEmail(email)})
  const {data:generated,error}=await admin.auth.admin.generateLink({type:'invite',email,options:{redirectTo:firstAccessRedirectUrl(),data:{full_name:name,phone,ruah_public_registration:true}}})
  if(error||!generated.user||!generated.properties?.action_link){const alreadyExists=/already.*(?:registered|exists)|user.*exists/i.test(`${error?.code??''} ${error?.message??''}`);console.error({event:'auth_link_generation_failed',email:maskedEmail(email),code:alreadyExists?'account_already_exists':'invite_link_failed'});console.error({event:'registration_failed',stage:'auth_link',code:alreadyExists?'account_already_exists':'invite_link_failed'});return json({error:{code:alreadyExists?'account_already_exists':'invite_link_failed',message:alreadyExists?'Já existe uma conta para este e-mail. Entre com sua senha ou use “Esqueci minha senha”.':'Não foi possível preparar seu convite agora. Tente novamente em instantes.'}},alreadyExists?409:502,req)}
  console.log({event:'auth_link_generation_success',email:maskedEmail(email)})
  const {error:requestError}=await admin.from('customer_identity_requests').upsert({organization_id:org,auth_user_id:generated.user.id,full_name:name,email,phone,status:'email_pending'},{onConflict:'auth_user_id'})
  if(requestError){console.error({event:'registration_failed',stage:'identity_request',code:'identity_request_failed'});return json({error:{code:'registration_failed',message:'Não foi possível concluir seu cadastro agora. Tente novamente em instantes.'}},502,req)}
  const emailResult=await sendInviteEmail({to:email,name,actionLink:generated.properties.action_link,source:'customer-registration-start'})
  if(emailResult.status!=='sent'){console.error({event:'registration_failed',stage:'email',code:emailResult.error??'email_delivery_failed'});return json({error:{code:'email_delivery_failed',message:'Seu cadastro foi recebido, mas não conseguimos enviar o e-mail agora. Tente novamente em instantes.'}},502,req)}
  await admin.from('audit_logs').insert({organization_id:org,actor_id:generated.user.id,action:'ACCOUNT_CREATED',entity_type:'customer_identity_request',entity_id:generated.user.id})
  console.log({event:'registration_complete',email:maskedEmail(email),provider:'resend',provider_message_id:emailResult.provider_message_id})
  return json({data:{code:'invite_sent',status:'invite_sent',email:maskedEmail(email),provider:'resend',provider_message_id:emailResult.provider_message_id}},200,req)
})
