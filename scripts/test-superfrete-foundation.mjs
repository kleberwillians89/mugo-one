import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

// Teste remoto controlado: valida banco/RPCs com respostas simuladas. Nunca chama a API SuperFrete.
const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const serviceKey=keys.find(item=>item.name==='service_role'||item.type==='service_role')?.api_key
const anonKey=keys.find(item=>item.name==='anon'||item.type==='publishable')?.api_key
if(!serviceKey||!anonKey)throw new Error('Chaves do projeto indisponíveis.')
const base=`https://${projectRef}.supabase.co`,email=`superfrete-test-${randomUUID()}@example.invalid`,password=`T!${randomUUID()}a9`
const serviceHeaders={apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'}
const request=async(url,options={},headers=serviceHeaders)=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}});const text=await response.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}if(!response.ok)throw new Error(`${options.method??'GET'}: ${body?.message??body?.error_description??response.status}`);return body}
const rest=(path,options={},headers)=>request(`${base}/rest/v1${path}`,options,headers)
const ids={user:null,client:null,perfume:null,item:null,sale:null,shipment:null}
let createdSettings=false
let productionQuoteServices=0
try{
  const existingSettings=await rest(`/organization_shipping_settings?organization_id=eq.${organizationId}&select=organization_id`)
  if(existingSettings.length)throw new Error('Configuração real existente; teste controlado recusou substituí-la.')
  const created=await request(`${base}/auth/v1/admin/users`,{method:'POST',body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'Teste SuperFrete controlado'}})});ids.user=created.id
  await rest('/organization_members',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({organization_id:organizationId,user_id:ids.user,role:'admin'})})
  const auth=await request(`${base}/auth/v1/token?grant_type=password`,{method:'POST',body:JSON.stringify({email,password})},{apikey:anonKey,'content-type':'application/json'})
  const userHeaders={apikey:anonKey,authorization:`Bearer ${auth.access_token}`,'content-type':'application/json'}
  await rest('/organization_shipping_settings',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({organization_id:organizationId,sender_name:'REMETENTE TESTE',sender_document:'12345678901',sender_email:'teste@example.invalid',sender_phone:'11999999999',sender_postal_code:'01001000',sender_address:'Rua Teste',sender_number:'1',sender_district:'Centro',sender_city:'São Paulo',sender_state:'SP',default_weight:.4,default_height:10,default_width:12,default_length:18,updated_by:ids.user})},userHeaders);createdSettings=true
  const [client]=await rest('/clients?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,name:'TESTE SUPERFRETE CONTROLADO',normalized_name:`teste superfrete ${randomUUID()}`,phone:'11988888888',email:'destino@example.invalid',cpf:'98765432100',postal_code:'20040002',address_line:'Rua Destino',address_number:'20',district:'Centro',city:'Rio de Janeiro',state:'RJ',status:'active',source:'controlled_test',created_by:ids.user})},userHeaders);ids.client=client.id
  const [perfume]=await rest('/perfumes?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,full_name_raw:'PERFUME TESTE SUPERFRETE',normalized_name:`perfume teste superfrete ${randomUUID()}`,base_name:'PERFUME TESTE SUPERFRETE'})},userHeaders);ids.perfume=perfume.id
  const [item]=await rest('/inventory_items?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,perfume_id:ids.perfume,reference_date:'2026-08-13',available_ml:20,physical_ml:20,minimum_ml:0,status:'active',reconciliation_status:'reconciled',created_by:ids.user})});ids.item=item.id
  const [sale]=await rest('/sales?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,client_id:ids.client,perfume_id:ids.perfume,sale_date:'2026-08-13',amount:250,payment_status:'paid',source:'manual',sale_type:'SPLIT',volume_ml:10,volume_ml_raw:'10',perfume_name_raw:'PERFUME TESTE SUPERFRETE',inventory_allocation_eligible:true,operational_created_at:new Date().toISOString(),created_by:ids.user})},userHeaders);ids.sale=sale.id
  const [allocation]=await rest(`/inventory_allocations?sale_id=eq.${ids.sale}&select=id,status`)
  ids.shipment=await rest('/rpc/create_draft_shipment',{method:'POST',body:JSON.stringify({p_client_id:ids.client,p_allocation_ids:[allocation.id],p_notes:'Mock sem API externa'})},userHeaders)
  const [draft]=await rest(`/shipments?id=eq.${ids.shipment}&select=package_weight,declared_value,recipient_address,status`)
  if(Number(draft.package_weight)!==.4||Number(draft.declared_value)!==250||draft.recipient_address!=='Rua Destino')throw new Error('defaults/snapshot incorretos')
  if(process.argv.includes('--production-quote')){
    const response=await request(`${base}/functions/v1/superfrete-quote`,{method:'POST',body:JSON.stringify({organization_id:organizationId,shipment_id:ids.shipment})},userHeaders)
    productionQuoteServices=Array.isArray(response?.data)?response.data.filter(item=>item.available).length:0
    if(productionQuoteServices<1)throw new Error('cotação de produção não retornou serviço disponível')
  }
  const quotes=await rest('/rpc/save_superfrete_quotes',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_quotes:[{service_id:'1',service_name:'PAC MOCK',carrier:'Correios',price:25.5,delivery_days:5,available:true,package:{weight:.4,height:10,width:12,length:18}}]})},userHeaders)
  await rest('/rpc/select_shipment_quote',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_quote_id:quotes[0].id})},userHeaders)
  await rest('/rpc/approve_shipment_for_label',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment})},userHeaders)
  const claim=await rest('/rpc/claim_superfrete_cart',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_idempotency_key:`${ids.shipment}:cart:v1`})},userHeaders)
  const duplicateClaim=await rest('/rpc/claim_superfrete_cart',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_idempotency_key:`${ids.shipment}:cart:v1`})},userHeaders)
  if(!claim.claimed||duplicateClaim.claimed)throw new Error('claim de cart não idempotente')
  await rest('/rpc/complete_superfrete_cart',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_run_id:claim.run_id,p_order_id:`mock-${randomUUID()}`,p_protocol:'mock',p_price:25.5})},userHeaders)
  const checkout=await rest('/rpc/claim_superfrete_checkout',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment})},userHeaders)
  const duplicateCheckout=await rest('/rpc/claim_superfrete_checkout',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment})},userHeaders)
  if(!checkout.claimed||duplicateCheckout.claimed)throw new Error('claim de checkout não idempotente')
  await rest('/rpc/apply_superfrete_state',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_run_id:checkout.run_id,p_state:{status:'released',tracking:'MOCKTRACK',price:'25.50',delivery:'5',print:{url:'https://example.invalid/mock.pdf'}}})},userHeaders)
  const [released]=await rest(`/shipments?id=eq.${ids.shipment}&select=status,tracking_code,print_url,checkout_status`)
  if(released.status!=='label_released'||released.tracking_code!=='MOCKTRACK'||released.checkout_status!=='released')throw new Error('sync de release incorreto')
  await rest('/rpc/apply_superfrete_state',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_run_id:null,p_state:{status:'posted',posted_at:new Date().toISOString()}})},userHeaders)
  await rest('/rpc/apply_superfrete_state',{method:'POST',body:JSON.stringify({p_shipment_id:ids.shipment,p_run_id:null,p_state:{status:'posted'}})},userHeaders)
  const [stock]=await rest(`/inventory_items?id=eq.${ids.item}&select=physical_ml`)
  if(Number(stock.physical_ml)!==10)throw new Error('postagem mock baixou estoque mais de uma vez')
  console.log(JSON.stringify({external_api_calls:process.argv.includes('--production-quote')?1:0,external_endpoint:process.argv.includes('--production-quote')?'calculator only':'none',production_quote_services:productionQuoteServices,quote_persisted:true,selection_requires_approval:true,cart_claim_idempotent:true,checkout_claim_idempotent:true,released_sync:true,tracking_sync:true,print_url_sync:true,posted_stock_once:true},null,2))
}finally{
  if(ids.shipment){await rest(`/shipments?id=eq.${ids.shipment}`,{method:'PATCH',body:JSON.stringify({selected_quote_id:null})}).catch(()=>{});await rest(`/shipment_events?shipment_id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/integration_runs?entity_id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipment_items?shipment_id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipment_quotes?shipment_id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/inventory_allocations?shipment_id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipments?id=eq.${ids.shipment}`,{method:'DELETE'}).catch(()=>{})}
  if(ids.sale)await rest(`/inventory_allocations?sale_id=eq.${ids.sale}`,{method:'DELETE'}).catch(()=>{})
  if(ids.sale)await rest(`/sales?id=eq.${ids.sale}`,{method:'DELETE'}).catch(()=>{})
  if(ids.item)await rest(`/inventory_items?id=eq.${ids.item}`,{method:'DELETE'}).catch(()=>{})
  if(ids.perfume)await rest(`/perfumes?id=eq.${ids.perfume}`,{method:'DELETE'}).catch(()=>{})
  if(ids.client)await rest(`/clients?id=eq.${ids.client}`,{method:'DELETE'}).catch(()=>{})
  if(createdSettings)await rest(`/organization_shipping_settings?organization_id=eq.${organizationId}`,{method:'DELETE'}).catch(()=>{})
  if(ids.user){await rest(`/organization_members?user_id=eq.${ids.user}`,{method:'DELETE'}).catch(()=>{});await request(`${base}/auth/v1/admin/users/${ids.user}`,{method:'DELETE'}).catch(()=>{})}
}
