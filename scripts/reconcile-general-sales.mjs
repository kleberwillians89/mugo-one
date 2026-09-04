import{createHash}from'node:crypto'
import{execFileSync}from'node:child_process'
import fs from'node:fs'
import path from'node:path'

const organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const projectRef='pfhvqkzafgoyumxmbwqc'
const input=process.argv[2],snapshotPath=process.argv[3],mode=process.argv[4]??'dry-run'
if(!input||!snapshotPath||!['dry-run','apply','rollback'].includes(mode))throw new Error('Uso: node scripts/reconcile-general-sales.mjs fonte.csv snapshot.json [dry-run|apply|rollback]')
const sha256=value=>createHash('sha256').update(value).digest('hex')
const round=value=>Math.round(value*100)/100
const brl=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value)
const deterministicUuid=hash=>`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`
const sourceName=path.basename(input),snapshotName=path.basename(snapshotPath)
const sourceHash=sha256(fs.readFileSync(input))
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'))
if(snapshot.project_ref!==projectRef)throw new Error('Snapshot pertence a outro projeto.')

const stagingFiles=fs.readdirSync('private_data').filter(name=>name.startsWith('incremental-staging-')&&name.endsWith('.json')).sort().reverse()
let staged,stagingName
for(const name of stagingFiles){const candidate=JSON.parse(fs.readFileSync(path.join('private_data',name),'utf8'));if(candidate.report.source===sourceName&&candidate.report.snapshot===snapshotName){staged=candidate;stagingName=name;break}}
if(!staged)throw new Error('Staging correspondente à fonte e ao snapshot não encontrado. Execute analyze:incremental primeiro.')

const sales=(snapshot.tables.sales??[]).filter(row=>row.deleted_at===null)
const saleById=new Map(sales.map(row=>[row.id,row]))
const clients=new Map((snapshot.tables.clients??[]).map(row=>[row.id,row]))
const activeAllocationStatuses=new Set(['reserved','shipping','shipped'])
const activeAllocations=(snapshot.tables.inventory_allocations??[]).filter(row=>activeAllocationStatuses.has(row.status))
const activeAllocationBySale=new Set(activeAllocations.map(row=>row.sale_id))
const allocationById=new Map((snapshot.tables.inventory_allocations??[]).map(row=>[row.id,row]))
const preparationById=new Map((snapshot.tables.preparation_batches??[]).map(row=>[row.id,row]))
const activePreparationSales=new Set((snapshot.tables.preparation_batch_items??[]).filter(row=>preparationById.get(row.batch_id)?.status!=='cancelled').map(row=>allocationById.get(row.allocation_id)?.sale_id).filter(Boolean))
const shipmentById=new Map((snapshot.tables.shipments??[]).map(row=>[row.id,row]))
const activeShipmentSales=new Set((snapshot.tables.shipment_items??[]).filter(row=>row.removed_at==null&&!['posted','delivered','cancelled'].includes(shipmentById.get(row.shipment_id)?.status)).map(row=>row.sale_id))
const postedShipmentSales=new Set((snapshot.tables.shipment_items??[]).filter(row=>row.removed_at==null&&shipmentById.get(row.shipment_id)?.posted_at).map(row=>row.sale_id))

const allowedChanges=new Set(['payment_status','payment_method','paid_at'])
const changedCandidates=staged.rows.filter(row=>row.classification==='existing_changed'&&row.match_candidate&&row.payment_status==='paid')
const rejectedSafeCandidates=[]
const payload=[]
for(const row of changedCandidates){
  const sale=saleById.get(row.match_candidate),changeKeys=Object.keys(row.proposed_changes??{})
  const reasons=[]
  if(!sale)reasons.push('sale_missing')
  if(changeKeys.some(key=>!allowedChanges.has(key))||!changeKeys.includes('payment_status'))reasons.push('unexpected_change_set')
  if(sale?.payment_status!=='pending')reasons.push('not_pending')
  if(sale?.inventory_allocation_eligible!==true)reasons.push('incompatible_inventory_eligibility')
  if(activeAllocationBySale.has(row.match_candidate))reasons.push('active_allocation')
  if(activePreparationSales.has(row.match_candidate))reasons.push('active_preparation')
  if(activeShipmentSales.has(row.match_candidate))reasons.push('active_shipment')
  const targetMethod=String(row.raw?.['FORMA DE PAGAMENTO']??'').trim()
  if(!targetMethod||!row.paid_at)reasons.push('missing_approved_payment_evidence')
  if(reasons.length){rejectedSafeCandidates.push({sale_id:row.match_candidate,source_row:row.source_row,reasons});continue}
  payload.push({
    sale_id:sale.id,source_row:row.source_row,source_signature:row.signature,match_method:'exact_commercial_multiset',
    expected_updated_at:sale.updated_at,expected_payment_status:sale.payment_status,expected_payment_method:sale.payment_method??'',expected_paid_at:sale.paid_at??'',
    expected_inventory_allocation_eligible:sale.inventory_allocation_eligible,expected_shipping_operational_status:sale.shipping_operational_status??'',
    source_payment_status:'paid',target_payment_status:'paid',target_payment_method:targetMethod,target_paid_at:row.paid_at,
    target_inventory_allocation_eligible:false,target_shipping_operational_status:'ENVIADO',
  })
}
payload.sort((a,b)=>a.sale_id.localeCompare(b.sale_id))
const operationHash=sha256(JSON.stringify({organization_id:organizationId,source_hash:sourceHash,rows:payload}))
const batchId=deterministicUuid(operationHash)
const payloadIds=new Set(payload.map(row=>row.sale_id))
const currentPending=sales.filter(row=>row.payment_status==='pending')
const pendingAfter=currentPending.filter(row=>!payloadIds.has(row.id))
const currentPaid=sales.filter(row=>row.payment_status==='paid')
const cancelled=sales.filter(row=>row.payment_status==='cancelled')
const unknown=sales.filter(row=>row.payment_status==='unknown')
const specialOperational=sales.filter(row=>row.shipping_operational_status==='CANCELADO'&&row.payment_status!=='cancelled')
const amount=row=>Number(row.amount??0)
const pendingClients=[...new Set(pendingAfter.map(row=>row.client_id).filter(Boolean))].map(id=>({client_id:id,name:clients.get(id)?.name??'Cliente sem nome'})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
const actualSentPending=currentPending.filter(row=>row.shipped_at||postedShipmentSales.has(row.id))
const report={
  title:'RUAH — RECONCILIAÇÃO DRY-RUN',created_at:new Date().toISOString(),mode:'dry-run',database_writes:0,
  source:{file:sourceName,sha256:sourceHash,rows:staged.report.total_lines,operational_rows_ignored:staged.report.ignored_operational_lines,staging:stagingName,snapshot:snapshotName},
  batch:{batch_id:batchId,operation_hash:operationHash,safe_rows:payload.length},
  crm:{sales_analyzed:sales.length,matched_safe:staged.report.existing_exact+staged.report.existing_changed,not_found_in_spreadsheet:staged.report.missing_from_new_source,ambiguous:staged.report.possible_duplicate,review_required:staged.report.review_required,skipped_cancelled_source:staged.report.skipped_cancelled_source},
  financial:{
    paid_before:currentPaid.length,remain_paid:currentPaid.length,change_to_paid:payload.length,paid_after:currentPaid.length+payload.length,
    pending_before:currentPending.length,remain_pending:pendingAfter.length,change_to_pending:0,pending_after:pendingAfter.length,
    cancelled_preserved:cancelled.length,unknown_preserved:unknown.length,
    pending_value_before:round(currentPending.reduce((sum,row)=>sum+amount(row),0)),pending_value_after:round(pendingAfter.reduce((sum,row)=>sum+amount(row),0)),
    value_marked_settled:round(payload.reduce((sum,row)=>sum+amount(saleById.get(row.sale_id)),0)),
  },
  logistics:{
    business_sent_before:currentPaid.filter(row=>row.shipping_operational_status!=='CANCELADO').length,
    change_to_business_sent:payload.length,
    business_sent_after:currentPaid.filter(row=>row.shipping_operational_status!=='CANCELADO').length+payload.length,
    pending_displayed_as_missing_shipment_after:pendingAfter.length,
    leave_business_sent_display_but_preserve_real_metadata:actualSentPending.length,
    real_shipped_at_cleared:0,shipments_created:0,shipment_rows_updated:0,
  },
  collections:{clients_before:new Set(currentPending.map(row=>row.client_id).filter(Boolean)).size,clients_after:pendingClients.length,pending_orders_after:pendingAfter.length,pending_perfume_orders_after:pendingAfter.filter(row=>row.perfume_id).length,pending_value_after:round(pendingAfter.reduce((sum,row)=>sum+amount(row),0)),clients_remaining:pendingClients},
  preservation:{inventory_items_updated:0,inventory_movements_created:0,inventory_allocations_created:0,available_ml_change:0,cancelled_preserved:cancelled.length,stock_rows_ignored:staged.report.ignored_operational_lines,special_records_ignored:specialOperational.length+unknown.length},
  divergences:{ambiguous_source_rows:staged.report.possible_duplicate,review_required_source_rows:staged.report.review_required,skipped_cancelled_source:staged.report.skipped_cancelled_source,crm_sales_absent_from_source:staged.report.missing_from_new_source,rejected_safe_candidates:rejectedSafeCandidates},
  gates:{safe_payload_non_empty:payload.length>0,safe_candidates_all_accepted:rejectedSafeCandidates.length===0,no_active_inventory_or_logistics:payload.every(row=>!activeAllocationBySale.has(row.sale_id)&&!activePreparationSales.has(row.sale_id)&&!activeShipmentSales.has(row.sale_id)),ambiguous_rows_excluded:true,no_destructive_operations:true},
}
const plan={report,payload}
fs.mkdirSync('private_data',{recursive:true})
const planPath=path.join('private_data',`general-sales-reconciliation-${batchId}.json`)
fs.writeFileSync(planPath,JSON.stringify(plan,null,2))

const print=()=>console.log(`\n========================================\nRUAH — RECONCILIAÇÃO DRY-RUN\n========================================\n\nSales no CRM: ${report.crm.sales_analyzed}\nEncontradas com match seguro: ${report.crm.matched_safe}\nAmbíguas (preservadas): ${report.crm.ambiguous}\nRevisão obrigatória (preservada): ${report.crm.review_required}\nCRM ausente na planilha (preservado): ${report.crm.not_found_in_spreadsheet}\n\nPAGO / ENVIADO\nJá paid: ${report.financial.paid_before}\nMudará para paid: ${report.financial.change_to_paid}\nPaid depois: ${report.financial.paid_after}\nMarcadas como enviadas pela regra de negócio: ${report.logistics.change_to_business_sent}\n\nPENDENTE / FALTANDO ENVIAR\nPending antes: ${report.financial.pending_before}\nPermanecerá pending: ${report.financial.pending_after}\nClientes ainda em cobrança: ${report.collections.clients_after}\nPedidos/perfumes pendentes: ${report.collections.pending_perfume_orders_after}\nTotal financeiro pendente: ${brl(report.financial.pending_value_after)}\nValor marcado como quitado: ${brl(report.financial.value_marked_settled)}\n\nCancelados preservados: ${report.financial.cancelled_preserved}\nEstoque ignorado: ${report.preservation.stock_rows_ignored} linhas da fonte; 0 mutações\nEspeciais/unknown preservados: ${report.preservation.special_records_ignored}\nSnapshot/rollback: ${planPath}\n\n========================================\nNENHUMA ALTERAÇÃO REALIZADA\n========================================\n`)
print()
if(mode==='dry-run')process.exit(0)
if(!Object.values(report.gates).every(Boolean))throw new Error('Gates do dry-run falharam; nenhuma escrita permitida.')
if(Date.now()-new Date(snapshot.created_at).getTime()>15*60*1000)throw new Error('Snapshot com mais de 15 minutos; gere outro antes de escrever.')

const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find(item=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`,headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'}
const request=async(url,options={})=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}});const text=await response.text(),body=text?JSON.parse(text):null;if(!response.ok)throw new Error(body?.message??`HTTP ${response.status}`);return body}
const admins=await request(`${base}/organization_members?organization_id=eq.${organizationId}&role=eq.admin&select=user_id&limit=1`)
if(admins.length!==1)throw new Error('Administrador da organização não encontrado.')
const rpc=mode==='apply'?'apply_general_sales_reconciliation':'rollback_general_sales_reconciliation'
const body=mode==='apply'?{p_organization_id:organizationId,p_user_id:admins[0].user_id,p_batch_id:batchId,p_source_file:sourceName,p_source_hash:sourceHash,p_operation_hash:operationHash,p_rows:payload}:{p_organization_id:organizationId,p_user_id:admins[0].user_id,p_batch_id:batchId,p_operation_hash:operationHash}
const result=await request(`${base}/rpc/${rpc}`,{method:'POST',body:JSON.stringify(body)})
console.log(JSON.stringify({mode,batch_id:batchId,operation_hash:operationHash,result},null,2))
