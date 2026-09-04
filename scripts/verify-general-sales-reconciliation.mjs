import{execFileSync}from'node:child_process'
import fs from'node:fs'

const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const beforePath=process.argv[2],afterPath=process.argv[3],planPath=process.argv[4]
if(!beforePath||!afterPath||!planPath)throw new Error('Uso: node scripts/verify-general-sales-reconciliation.mjs before.json after.json plan.json')
const before=JSON.parse(fs.readFileSync(beforePath,'utf8')),after=JSON.parse(fs.readFileSync(afterPath,'utf8')),plan=JSON.parse(fs.readFileSync(planPath,'utf8'))
const table=(snapshot,name)=>snapshot.tables[name]??[]
const byId=rows=>new Map(rows.map(row=>[row.id,row]))
const beforeSales=byId(table(before,'sales')),afterSales=byId(table(after,'sales')),payloadById=new Map(plan.payload.map(row=>[row.sale_id,row]))
const allowedSaleChanges=new Set(['inventory_allocation_eligible','payment_status','payment_method','paid_at','shipping_operational_status','updated_at'])
const saleFailures=[],unexpectedSaleChanges=[]
for(const [id,afterRow]of afterSales){
  const beforeRow=beforeSales.get(id);if(!beforeRow){unexpectedSaleChanges.push({sale_id:id,reason:'created'});continue}
  const changed=Object.keys(afterRow).filter(key=>JSON.stringify(afterRow[key])!==JSON.stringify(beforeRow[key]))
  const target=payloadById.get(id)
  if(!target&&changed.length)unexpectedSaleChanges.push({sale_id:id,changed_fields:changed})
  if(target){
    if(changed.some(key=>!allowedSaleChanges.has(key)))saleFailures.push({sale_id:id,reason:'unexpected_field',changed_fields:changed})
    if(afterRow.payment_status!=='paid'||afterRow.payment_method!==target.target_payment_method||afterRow.paid_at!==target.target_paid_at||afterRow.inventory_allocation_eligible!==false||afterRow.shipping_operational_status!=='ENVIADO')saleFailures.push({sale_id:id,reason:'target_state_mismatch'})
  }
}
for(const id of beforeSales.keys())if(!afterSales.has(id))unexpectedSaleChanges.push({sale_id:id,reason:'deleted'})
const stableTables=['clients','perfumes','inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','shipments','preparation_batches','preparation_batch_items','shipment_items','shipment_events']
const stableTableChecks=Object.fromEntries(stableTables.map(name=>[name,JSON.stringify(table(before,name))===JSON.stringify(table(after,name))]))
const batchAudit=table(after,'audit_logs').filter(row=>row.action==='general_sales_reconciliation_completed'&&row.entity_id===plan.report.batch.batch_id)
const saleAudits=table(after,'audit_logs').filter(row=>row.action==='general_sale_reconciled'&&row.metadata?.batch_id===plan.report.batch.batch_id)
const manychatBefore=table(before,'audit_logs').filter(row=>row.action==='manychat_flow_requested').length
const manychatAfter=table(after,'audit_logs').filter(row=>row.action==='manychat_flow_requested').length

const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find(item=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`,headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'}
const request=async(name,body)=>{const response=await fetch(`${base}/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)}),text=await response.text(),data=text?JSON.parse(text):null;if(!response.ok)throw new Error(data?.message??`HTTP ${response.status}`);return data}
const canonical=await request('collections_pending_sales_canonical',{p_organization_id:organizationId})
const afterPending=table(after,'sales').filter(row=>row.organization_id===organizationId&&row.deleted_at===null&&row.payment_status==='pending')
const canonicalIds=new Set(canonical.map(row=>row.id)),afterPendingIds=new Set(afterPending.map(row=>row.id))
const canonicalMatchesSales=canonicalIds.size===afterPendingIds.size&&[...canonicalIds].every(id=>afterPendingIds.has(id))&&canonical.every(row=>row.payment_status==='pending')
const clientCounts=new Map()
for(const client of table(after,'clients'))for(const phone of new Set([client.normalized_whatsapp,client.normalized_phone].filter(Boolean)))clientCounts.set(phone,(clientCounts.get(phone)??0)+1)
const testClient=table(after,'clients').find(client=>afterPending.some(sale=>sale.client_id===client.id)&&[client.normalized_whatsapp,client.normalized_phone].some(phone=>phone&&/^55[1-9][0-9]{9,10}$/.test(phone)&&clientCounts.get(phone)===1))
if(!testClient)throw new Error('Nenhum cliente pending com telefone único para validar o saldo real.')
const phone=[testClient.normalized_whatsapp,testClient.normalized_phone].find(value=>value&&clientCounts.get(value)===1)
const balance=await request('whatsapp_customer_balance_v1',{p_organization_id:organizationId,p_normalized_phone:phone})
const clientCanonical=canonical.filter(row=>row.client_id===testClient.id),clientTotal=clientCanonical.reduce((sum,row)=>sum+Number(row.amount),0)
const balanceMatchesCanonical=balance.status==='ok'&&Number(balance.open_orders)===clientCanonical.length&&Math.abs(Number(balance.total_pending)-clientTotal)<0.005
const groupedClients=[...canonical.reduce((map,row)=>{const current=map.get(row.client_id)??{client_id:row.client_id,client_name:row.client_name,open_orders:0,total_pending:0};current.open_orders++;current.total_pending+=Number(row.amount);map.set(row.client_id,current);return map},new Map()).values()].sort((a,b)=>a.client_name.localeCompare(b.client_name,'pt-BR'))
const csvCell=value=>`"${String(value??'').replaceAll('"','""')}"`
const clientListPath=`private_data/clients-still-in-collections-${plan.report.batch.batch_id}.csv`
fs.writeFileSync(clientListPath,['client_id,client_name,open_orders,total_pending',...groupedClients.map(row=>[row.client_id,row.client_name,row.open_orders,Math.round(row.total_pending*100)/100].map(csvCell).join(','))].join('\n'))
const result={
  batch_id:plan.report.batch.batch_id,expected_sales:plan.payload.length,verified_target_sales:plan.payload.length-saleFailures.length,
  sale_failures:saleFailures,unexpected_sale_changes:unexpectedSaleChanges,stable_tables:stableTableChecks,
  financial_before:before.baseline.financial,financial_after:after.baseline.financial,
  audit:{batch_records:batchAudit.length,sale_records:saleAudits.length},
  collections:{canonical_rows:canonical.length,direct_pending_rows:afterPending.length,unique_clients:new Set(canonical.map(row=>row.client_id)).size,total:Math.round(canonical.reduce((sum,row)=>sum+Number(row.amount),0)*100)/100,all_and_only_pending:canonicalMatchesSales,client_list_file:clientListPath},
  manychat_balance:{tested_client_id:testClient.id,canonical_orders:clientCanonical.length,canonical_total:Math.round(clientTotal*100)/100,rpc_status:balance.status,rpc_orders:balance.open_orders,rpc_total:Number(balance.total_pending),matches_canonical:balanceMatchesCanonical},
  manychat_messages:{audit_before:manychatBefore,audit_after:manychatAfter,new_messages:manychatAfter-manychatBefore},
}
result.ok=saleFailures.length===0&&unexpectedSaleChanges.length===0&&Object.values(stableTableChecks).every(Boolean)&&batchAudit.length===1&&saleAudits.length===plan.payload.length&&canonicalMatchesSales&&balanceMatchesCanonical&&result.manychat_messages.new_messages===0
console.log(JSON.stringify(result,null,2))
if(!result.ok)process.exitCode=1
