import fs from'node:fs'
import path from'node:path'

const approved={
  organization_id:'032fd96e-638f-428b-8cc2-37afc71e10ea',
  batch_id:'858edc62-067f-4124-8d95-206230d1268f',
  operation_hash:'4fee55f810d6d66f13e5443cf79240fe0407202ddd54e15c48b619057a86ea66',
  rows:[
    {sale_id:'f676eb8b-7233-412d-80a9-6db94925384c',expected_updated_at:'2026-09-03T21:51:12.712+00:00',payment_method:'CARTÃO DE CRÉDITO',paid_at:'2026-08-28',historical_status:'ENVIADO',historical_shipped_at:'2026-09-03'},
    {sale_id:'98e9eb88-a071-46a8-a0b5-e10f904c9bfb',expected_updated_at:'2026-09-03T21:51:13.210+00:00',payment_method:'CARTÃO DE CRÉDITO',paid_at:'2026-08-28',historical_status:'ENVIADO',historical_shipped_at:'2026-09-03'},
  ],
}
const snapshots=fs.readdirSync('private_data').filter(name=>name.startsWith('supabase-snapshot-')&&name.endsWith('.json')).sort().reverse()
if(!snapshots.length)throw new Error('Snapshot local não encontrado.')
const snapshotName=snapshots[0]
const snapshot=JSON.parse(fs.readFileSync(path.join('private_data',snapshotName),'utf8'))
const sales=new Map(snapshot.tables.sales.map(row=>[row.id,row]))
const activeStatuses=new Set(['reserved','shipping','shipped'])
const activeAllocations=snapshot.tables.inventory_allocations.filter(row=>activeStatuses.has(row.status))
const preparations=snapshot.tables.preparation_batches??[]
const preparationItems=snapshot.tables.preparation_batch_items??[]
const shipments=snapshot.tables.shipments??[]
const shipmentItems=snapshot.tables.shipment_items??[]
const allocationsById=new Map(snapshot.tables.inventory_allocations.map(row=>[row.id,row]))
const preparationsById=new Map(preparations.map(row=>[row.id,row]))
const shipmentsById=new Map(shipments.map(row=>[row.id,row]))
const inventoryBefore=JSON.stringify(snapshot.tables.inventory_items)
const movementsBefore=JSON.stringify(snapshot.tables.inventory_movements)
const allocationsBefore=JSON.stringify(snapshot.tables.inventory_allocations)

const rows=approved.rows.map(input=>{
  const sale=sales.get(input.sale_id)
  if(!sale)throw new Error(`Venda não encontrada: ${input.sale_id}`)
  const checks={
    tenant:sale.organization_id===approved.organization_id,
    pending:sale.payment_status==='pending',
    allocation_eligible:sale.inventory_allocation_eligible===true,
    unchanged:new Date(sale.updated_at).getTime()===new Date(input.expected_updated_at).getTime(),
    approved_evidence:input.historical_status==='ENVIADO'&&sale.shipped_at?.slice(0,10)===input.historical_shipped_at,
    no_active_allocation:!activeAllocations.some(row=>row.sale_id===sale.id),
    no_active_preparation:!preparationItems.some(row=>allocationsById.get(row.allocation_id)?.sale_id===sale.id&&preparationsById.get(row.batch_id)?.status!=='cancelled'),
    no_active_shipment:!shipmentItems.some(row=>row.sale_id===sale.id&&row.removed_at==null&&!['posted','delivered','cancelled'].includes(shipmentsById.get(row.shipment_id)?.status)),
    financial_state_empty:sale.payment_method==null&&sale.paid_at==null,
  }
  return{
    sale_id:sale.id,
    checks,
    eligible:Object.values(checks).every(Boolean),
    current:{payment_status:sale.payment_status,payment_method:sale.payment_method,paid_at:sale.paid_at,inventory_allocation_eligible:sale.inventory_allocation_eligible,updated_at:sale.updated_at},
    simulated:{payment_status:'paid',payment_method:input.payment_method,paid_at:input.paid_at,inventory_allocation_eligible:false,updated_at:'<database now()>'},
  }
})
const eligible=rows.every(row=>row.eligible)
const analyses=fs.readdirSync('private_data').filter(name=>name.startsWith('blocked-payment-analysis-')&&name.endsWith('.json')).sort().reverse()
const blocked=analyses.length?JSON.parse(fs.readFileSync(path.join('private_data',analyses[0]),'utf8')).rows:[]
const approvedIds=new Set(approved.rows.map(row=>row.sale_id))
const otherBlocked=blocked.filter(row=>!approvedIds.has(row.sale_id))
const availableTotal=snapshot.tables.inventory_items.reduce((sum,row)=>sum+Number(row.available_ml??0),0)
const report={mode:'dry-run',read_only:true,database_writes:0,snapshot:snapshotName,batch_id:approved.batch_id,operation_hash:approved.operation_hash,eligible,rows,
  other_blocked_sales:{count:otherBlocked.length,pending:otherBlocked.filter(row=>sales.get(row.sale_id)?.payment_status==='pending').length,updated:0},
  stock_projection:{available_ml_before:availableTotal,available_ml_after:availableTotal,movements_before:snapshot.tables.inventory_movements.length,movements_after:snapshot.tables.inventory_movements.length,allocations_before:snapshot.tables.inventory_allocations.length,allocations_after:snapshot.tables.inventory_allocations.length},
  invariants:{inventory_items_unchanged:inventoryBefore===JSON.stringify(snapshot.tables.inventory_items),inventory_movements_unchanged:movementsBefore===JSON.stringify(snapshot.tables.inventory_movements),inventory_allocations_unchanged:allocationsBefore===JSON.stringify(snapshot.tables.inventory_allocations),active_sales_outside_allowlist_updated:0}}
console.log(JSON.stringify(report,null,2))
if(!eligible)process.exitCode=1
