import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const serviceKey=keys.find((item)=>item.name==='service_role'||item.type==='service_role')?.api_key
const anonKey=keys.find((item)=>item.name==='anon'||item.type==='publishable')?.api_key
if(!serviceKey||!anonKey)throw new Error('Chaves do projeto indisponíveis.')
const base=`https://${projectRef}.supabase.co`,email=`operational-test-${randomUUID()}@example.invalid`,password=`T!${randomUUID()}a9`
const serviceHeaders={apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'}
const request=async(url,options={},headers=serviceHeaders)=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}});const text=await response.text();const body=text?JSON.parse(text):null;if(!response.ok)throw new Error(`${options.method??'GET'} ${url}: ${body?.message??body?.error_description??response.status}`);return body}
const rest=(path,options={},headers)=>request(`${base}/rest/v1${path}`,options,headers)
const cleanupControlled=async()=>{
  const controlled=await rest('/clients?source=eq.controlled_test&select=id,created_by')
  for(const client of controlled){
    const shipments=await rest(`/shipments?client_id=eq.${client.id}&select=id`)
    for(const shipment of shipments){await rest(`/shipment_events?shipment_id=eq.${shipment.id}`,{method:'DELETE'});await rest(`/shipment_items?shipment_id=eq.${shipment.id}`,{method:'DELETE'})}
    await rest(`/inventory_allocations?client_id=eq.${client.id}`,{method:'DELETE'})
    for(const shipment of shipments)await rest(`/shipments?id=eq.${shipment.id}`,{method:'DELETE'})
    await rest(`/sales?client_id=eq.${client.id}`,{method:'DELETE'})
    await rest(`/clients?id=eq.${client.id}`,{method:'DELETE'})
    if(client.created_by)await request(`${base}/auth/v1/admin/users/${client.created_by}`,{method:'DELETE'}).catch(()=>{})
  }
  if(process.argv.includes('--cleanup-only'))console.log(JSON.stringify({controlled_clients_removed:controlled.length}))
}
await cleanupControlled()
if(process.argv.includes('--cleanup-only'))process.exit(0)
const ids={user:null,client:null,perfume:null,item:null,sales:[],shipments:[]}
try{
  const created=await request(`${base}/auth/v1/admin/users`,{method:'POST',body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'Teste operacional controlado'}})})
  ids.user=created.id
  await rest('/organization_members',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({organization_id:organizationId,user_id:ids.user,role:'admin'})})
  const auth=await request(`${base}/auth/v1/token?grant_type=password`,{method:'POST',body:JSON.stringify({email,password})},{apikey:anonKey,'content-type':'application/json'})
  const userHeaders={apikey:anonKey,authorization:`Bearer ${auth.access_token}`,'content-type':'application/json'}
  const [client]=await rest('/clients?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,name:'TESTE OPERACIONAL CONTROLADO',normalized_name:'teste operacional controlado',address_line:'Rua A',address_number:'10',city:'São Paulo',state:'SP',status:'active',source:'controlled_test',created_by:ids.user})},userHeaders);ids.client=client.id
  const [perfume]=await rest('/perfumes?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,full_name_raw:'PERFUME TESTE OPERACIONAL',normalized_name:`perfume teste operacional ${randomUUID()}`,base_name:'PERFUME TESTE OPERACIONAL'})},userHeaders);ids.perfume=perfume.id
  const [item]=await rest('/inventory_items?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,perfume_id:ids.perfume,reference_date:'2026-08-13',available_ml:100,physical_ml:100,minimum_ml:0,status:'active',reconciliation_status:'reconciled',created_by:ids.user})});ids.item=item.id
  const makeSale=async(volume,status='pending')=>{const [sale]=await rest('/sales?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({organization_id:organizationId,client_id:ids.client,perfume_id:ids.perfume,sale_date:'2026-08-13',amount:100,payment_status:status,source:'manual',sale_type:'SPLIT',volume_ml:volume,volume_ml_raw:String(volume),perfume_name_raw:'PERFUME TESTE OPERACIONAL',inventory_allocation_eligible:true,operational_created_at:new Date().toISOString(),created_by:ids.user})},userHeaders);ids.sales.push(sale.id);return sale.id}
  const saleId=await makeSale(10)
  let allocations=await rest(`/inventory_allocations?sale_id=eq.${saleId}&select=id,status,quantity_ml`)
  if(allocations.length!==0)throw new Error('pending criou reserva')
  await rest(`/sales?id=eq.${saleId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_status:'paid'})},userHeaders)
  await rest(`/sales?id=eq.${saleId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_status:'paid'})},userHeaders)
  allocations=await rest(`/inventory_allocations?sale_id=eq.${saleId}&select=id,status,quantity_ml`)
  if(allocations.length!==1||allocations[0].status!=='reserved')throw new Error('reserva paga não idempotente')
  const shipmentId=await rest('/rpc/create_draft_shipment',{method:'POST',body:JSON.stringify({p_client_id:ids.client,p_allocation_ids:[allocations[0].id],p_notes:'Teste controlado'})},userHeaders);ids.shipments.push(shipmentId)
  const [snapshot]=await rest(`/shipments?id=eq.${shipmentId}&select=recipient_address,status`)
  await rest(`/clients?id=eq.${ids.client}`,{method:'PATCH',body:JSON.stringify({address_line:'Rua B'})},userHeaders)
  const [unchanged]=await rest(`/shipments?id=eq.${shipmentId}&select=recipient_address`)
  if(snapshot.recipient_address!=='Rua A'||unchanged.recipient_address!=='Rua A')throw new Error('snapshot de endereço alterado')
  await rest('/rpc/cancel_draft_shipment',{method:'POST',body:JSON.stringify({p_shipment_id:shipmentId})},userHeaders)
  const [released]=await rest(`/inventory_allocations?sale_id=eq.${saleId}&select=status`)
  if(released.status!=='reserved')throw new Error('cancelamento não devolveu reserva')
  const shipment2=await rest('/rpc/create_draft_shipment',{method:'POST',body:JSON.stringify({p_client_id:ids.client,p_allocation_ids:[allocations[0].id],p_notes:'Teste postagem'})},userHeaders);ids.shipments.push(shipment2)
  await rest(`/shipments?id=eq.${shipment2}`,{method:'PATCH',body:JSON.stringify({status:'customer_approved'})})
  await rest('/rpc/post_shipment',{method:'POST',body:JSON.stringify({p_shipment_id:shipment2})},userHeaders)
  await rest('/rpc/post_shipment',{method:'POST',body:JSON.stringify({p_shipment_id:shipment2})},userHeaders)
  const [afterPost]=await rest(`/inventory_items?id=eq.${ids.item}&select=physical_ml,available_ml`)
  if(Number(afterPost.physical_ml)!==90||Number(afterPost.available_ml)!==90)throw new Error('postagem duplicou ou divergiu da baixa')
  const concurrentA=await makeSale(60),concurrentB=await makeSale(60)
  const results=await Promise.allSettled([concurrentA,concurrentB].map((id)=>rest(`/sales?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({payment_status:'paid'})},userHeaders)))
  if(results.filter((result)=>result.status==='fulfilled').length!==1)throw new Error('concorrência não protegeu overselling')
  const [winner]=await rest(`/sales?id=in.(${concurrentA},${concurrentB})&payment_status=eq.paid&select=id`)
  await rest(`/sales?id=eq.${winner.id}`,{method:'PATCH',body:JSON.stringify({payment_status:'cancelled'})},userHeaders)
  const [afterRelease]=await rest(`/inventory_items?id=eq.${ids.item}&select=physical_ml,available_ml`)
  if(Number(afterRelease.physical_ml)!==90||Number(afterRelease.available_ml)!==90)throw new Error('cancelamento não liberou reserva concorrente')
  console.log(JSON.stringify({pending_no_reservation:true,paid_reserved:true,duplicate_reservation_blocked:true,shipment_snapshot:true,shipment_cancel_releases:true,post_once:true,post_retry_idempotent:true,concurrent_overselling_blocked:true,paid_cancelled_releases:true},null,2))
}finally{
  for(const shipment of ids.shipments){await rest(`/shipment_events?shipment_id=eq.${shipment}`,{method:'DELETE'}).catch(()=>{});await rest(`/shipment_items?shipment_id=eq.${shipment}`,{method:'DELETE'}).catch(()=>{})}
  for(const sale of ids.sales)await rest(`/inventory_allocations?sale_id=eq.${sale}`,{method:'DELETE'}).catch(()=>{})
  for(const shipment of ids.shipments)await rest(`/shipments?id=eq.${shipment}`,{method:'DELETE'}).catch(()=>{})
  for(const sale of ids.sales)await rest(`/sales?id=eq.${sale}`,{method:'DELETE'}).catch(()=>{})
  if(ids.item)await rest(`/inventory_items?id=eq.${ids.item}`,{method:'DELETE'}).catch(()=>{})
  if(ids.perfume)await rest(`/perfumes?id=eq.${ids.perfume}`,{method:'DELETE'}).catch(()=>{})
  if(ids.client)await rest(`/clients?id=eq.${ids.client}`,{method:'DELETE'}).catch(()=>{})
  if(ids.user){await rest(`/organization_members?user_id=eq.${ids.user}`,{method:'DELETE'}).catch(()=>{});await request(`${base}/auth/v1/admin/users/${ids.user}`,{method:'DELETE'}).catch(()=>{})}
}
