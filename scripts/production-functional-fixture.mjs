import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'

const action=process.argv[2],stateFile='private_data/production-functional-fixture.json'
if(!['setup','cleanup'].includes(action))throw new Error('Uso: node scripts/production-functional-fixture.mjs setup|cleanup')
const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea',keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'})),service=keys.find(x=>x.name==='service_role'||x.type==='service_role')?.api_key,anon=keys.find(x=>x.name==='anon'||x.type==='publishable')?.api_key
if(!service||!anon)throw new Error('Chaves indisponíveis.')
const base=`https://${projectRef}.supabase.co`,serviceHeaders={apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'}
const request=async(url,options={},headers=serviceHeaders)=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}}),text=await response.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}if(!response.ok)throw new Error(`${response.status}: ${body?.message??body?.error_description??JSON.stringify(body)}`);return body}
const rest=(path,options={},headers)=>request(`${base}/rest/v1${path}`,options,headers)
const cleanup=async state=>{
  const id=state.ids??{}
  if(id.shipment){await rest(`/shipments?id=eq.${id.shipment}`,{method:'PATCH',body:JSON.stringify({selected_quote_id:null})}).catch(()=>{});await rest(`/shipment_events?shipment_id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/integration_runs?entity_id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipment_items?shipment_id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipment_quotes?shipment_id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/inventory_allocations?shipment_id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipments?id=eq.${id.shipment}`,{method:'DELETE'}).catch(()=>{})}
  if(id.sale)await rest(`/inventory_allocations?sale_id=eq.${id.sale}`,{method:'DELETE'}).catch(()=>{})
  if(id.sale)await rest(`/sales?id=eq.${id.sale}`,{method:'DELETE'}).catch(()=>{})
  if(id.item)await rest(`/inventory_items?id=eq.${id.item}`,{method:'DELETE'}).catch(()=>{})
  if(id.perfume)await rest(`/perfumes?id=eq.${id.perfume}`,{method:'DELETE'}).catch(()=>{})
  if(id.client)await rest(`/clients?id=eq.${id.client}`,{method:'DELETE'}).catch(()=>{})
  if(state.createdSettings)await rest(`/organization_shipping_settings?organization_id=eq.${organizationId}`,{method:'DELETE'}).catch(()=>{})
  if(id.user){await rest(`/organization_members?user_id=eq.${id.user}`,{method:'DELETE'}).catch(()=>{});await request(`${base}/auth/v1/admin/users/${id.user}`,{method:'DELETE'}).catch(()=>{})}
}
if(action==='cleanup'){
  if(!fs.existsSync(stateFile)){console.log(JSON.stringify({cleaned:false,reason:'fixture_absent'}));process.exit(0)}
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));await cleanup(state);fs.unlinkSync(stateFile);console.log(JSON.stringify({cleaned:true,external_cart_calls:0,external_checkout_calls:0}));process.exit(0)
}
if(fs.existsSync(stateFile))throw new Error('Fixture anterior ainda existe; execute cleanup.')
const state={ids:{},createdSettings:false,email:`ruah-functional-${randomUUID()}@example.invalid`,password:`R!${randomUUID()}9a`,createdAt:new Date().toISOString()}
try{
  const existing=await rest(`/organization_shipping_settings?organization_id=eq.${organizationId}&select=organization_id`);if(existing.length)throw new Error('Configuração real já existe; fixture recusou sobrescrever.')
  const user=await request(`${base}/auth/v1/admin/users`,{method:'POST',body:JSON.stringify({email:state.email,password:state.password,email_confirm:true,user_metadata:{full_name:'Teste funcional RUAH'}})});state.ids.user=user.id
  await rest('/organization_members',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({organization_id:organizationId,user_id:user.id,role:'admin'})})
  const auth=await request(`${base}/auth/v1/token?grant_type=password`,{method:'POST',body:JSON.stringify({email:state.email,password:state.password})},{apikey:anon,'content-type':'application/json'}),userHeaders={apikey:anon,authorization:`Bearer ${auth.access_token}`,'content-type':'application/json'}
  await rest('/organization_shipping_settings',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({organization_id:organizationId,sender_name:'REMETENTE TESTE FUNCIONAL',sender_document:'12345678901',sender_email:'teste@example.invalid',sender_phone:'11999999999',sender_postal_code:'01001000',sender_address:'Praça da Sé',sender_number:'1',sender_district:'Sé',sender_city:'São Paulo',sender_state:'SP',default_weight:.4,default_height:10,default_width:12,default_length:18,updated_by:user.id})},userHeaders);state.createdSettings=true
  const [client]=await rest('/clients?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,name:'TESTE FUNCIONAL CLIENTE 360',normalized_name:`teste funcional ${randomUUID()}`,phone:'21988888888',whatsapp_phone:'21988888888',email:'destino@example.invalid',cpf:'98765432100',postal_code:'20040002',address_line:'Rua da Assembleia',address_number:'20',district:'Centro',city:'Rio de Janeiro',state:'RJ',status:'active',source:'controlled_test',created_by:user.id})},userHeaders);state.ids.client=client.id
  const [perfume]=await rest('/perfumes?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,full_name_raw:'PERFUME TESTE FUNCIONAL',normalized_name:`perfume teste ${randomUUID()}`,base_name:'PERFUME TESTE FUNCIONAL'})},userHeaders);state.ids.perfume=perfume.id
  const [item]=await rest('/inventory_items?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,perfume_id:perfume.id,reference_date:'2026-08-13',available_ml:20,physical_ml:20,minimum_ml:0,status:'active',reconciliation_status:'reconciled',created_by:user.id})});state.ids.item=item.id
  const [sale]=await rest('/sales?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,client_id:client.id,perfume_id:perfume.id,sale_date:'2026-08-13',amount:250,payment_status:'paid',payment_method:'PIX',paid_at:'2026-08-13',source:'manual',sale_type:'SPLIT',volume_ml:10,volume_ml_raw:'10',perfume_name_raw:'PERFUME TESTE FUNCIONAL',inventory_allocation_eligible:true,operational_created_at:new Date().toISOString(),created_by:user.id})},userHeaders);state.ids.sale=sale.id
  const [allocation]=await rest(`/inventory_allocations?sale_id=eq.${sale.id}&select=id,status`);if(!allocation||allocation.status!=='reserved')throw new Error('Allocation reserved não foi criada.');state.ids.allocation=allocation.id
  fs.mkdirSync('private_data',{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600})
  console.log(JSON.stringify({ready:true,client_id:client.id,allocation_id:allocation.id,allocation_status:'reserved',settings:'controlled_transient',external_calls:0,credentials_file:stateFile},null,2))
}catch(error){await cleanup(state);throw error}
