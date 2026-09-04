import {createHash} from 'node:crypto'
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {basename,join,resolve} from 'node:path'
import Papa from 'papaparse'
import {computeTotals} from '../src/lib/davi-import-diagnostics'
import {parseRows} from '../src/lib/importer'
// @ts-expect-error Motor ESM compartilhado com o diagnóstico do CRM.
import {analyzeDaviImport,stageDaviParsedRows} from './davi-import-diagnostics-lib.mjs'

type Row=Record<string,unknown>

const moneyCents=(value:unknown)=>Math.round(Number(value??0)*100)
const money=(cents:number)=>cents/100
const rows=(snapshot:Row,table:string)=>(snapshot.tables as Record<string,Row[]>)[table]??[]
const sum=(items:Row[])=>money(items.reduce((total,item)=>total+moneyCents(item.amount),0))
const groupFinancial=(items:Row[])=>Object.fromEntries(['paid','pending','cancelled','unknown'].map(status=>{
 const selected=items.filter(item=>String(item.payment_status??'unknown')===status)
 return[status,{count:selected.length,amount:sum(selected)}]
}))
const byId=(items:Row[])=>new Map(items.map(item=>[String(item.id),item]))
const add=<T>(map:Map<string,T[]>,key:string,value:T)=>map.set(key,[...(map.get(key)??[]),value])

const spreadsheetPath=resolve(process.argv[2]??'_reference/ruah-import/PLANILHA DAVI - ULTIMAS VENDAS.csv')
const snapshotArg=process.argv[3]
const latestSnapshot=snapshotArg?resolve(snapshotArg):join('private_data',readdirSync('private_data').filter(name=>/^supabase-snapshot-.*\.json$/.test(name)).sort().at(-1)??'')
if(!existsSync(spreadsheetPath))throw new Error(`Planilha não encontrada: ${spreadsheetPath}`)
if(!existsSync(latestSnapshot))throw new Error(`Snapshot não encontrado: ${latestSnapshot}`)

const spreadsheetBytes=readFileSync(spreadsheetPath)
const spreadsheetSha256=createHash('sha256').update(spreadsheetBytes).digest('hex')
const preview=parseRows(basename(spreadsheetPath),['CSV'],'CSV',Papa.parse<unknown[]>(spreadsheetBytes.toString('utf8'),{skipEmptyLines:true}).data)
const snapshot=JSON.parse(readFileSync(latestSnapshot,'utf8')) as Row
const sales=rows(snapshot,'sales')
const activeSales=sales.filter(sale=>sale.deleted_at==null)
snapshot.organization_id=[...new Set(activeSales.map(sale=>String(sale.organization_id)))][0]
const staging=stageDaviParsedRows(preview.rows,snapshot)
const analysis=analyzeDaviImport({staging,snapshot})
const totals=computeTotals(preview,analysis.rows,sales)
const crmOnlyIds=new Set(totals.divergences.filter(item=>item.category==='CRM_ONLY'&&item.sale_id).map(item=>String(item.sale_id)))
const crmOnly=activeSales.filter(sale=>crmOnlyIds.has(String(sale.id)))

if(crmOnly.length!==totals.categories.CRM_ONLY.crm_count)throw new Error('Universo CRM_ONLY inconsistente com o total reconciliado.')

const clients=byId(rows(snapshot,'clients'))
const perfumes=byId(rows(snapshot,'perfumes'))
const inventoryItems=byId(rows(snapshot,'inventory_items'))
const importBatches=byId(rows(snapshot,'import_batches'))
const shipments=byId(rows(snapshot,'shipments'))
const allocationsBySale=new Map<string,Row[]>()
for(const allocation of rows(snapshot,'inventory_allocations'))add(allocationsBySale,String(allocation.sale_id),allocation)
const shipmentItemsBySale=new Map<string,Row[]>(),shipmentItemsByAllocation=new Map<string,Row[]>()
for(const item of rows(snapshot,'shipment_items')){
 add(shipmentItemsBySale,String(item.sale_id),item)
 add(shipmentItemsByAllocation,String(item.allocation_id),item)
}
const preparationBatches=byId(rows(snapshot,'preparation_batches'))
const preparationItemsByAllocation=new Map<string,Row[]>()
for(const item of rows(snapshot,'preparation_batch_items'))add(preparationItemsByAllocation,String(item.allocation_id),item)
const customerRequests=byId(rows(snapshot,'customer_shipment_requests'))
const requestItemsByAllocation=new Map<string,Row[]>()
for(const item of rows(snapshot,'customer_shipment_request_items'))add(requestItemsByAllocation,String(item.allocation_id),item)
const movementsBySale=new Map<string,Row[]>()
for(const movement of rows(snapshot,'inventory_movements'))if(movement.sale_id)add(movementsBySale,String(movement.sale_id),movement)
const importRowsBySale=new Map<string,Row[]>()
for(const item of rows(snapshot,'import_rows'))if(item.sale_id)add(importRowsBySale,String(item.sale_id),item)
const stagingBySale=new Map<string,Row[]>()
for(const item of rows(snapshot,'incremental_import_staging'))if(item.match_sale_id)add(stagingBySale,String(item.match_sale_id),item)
const attachmentsBySale=new Map<string,Row[]>(),waitlistBySale=new Map<string,Row[]>(),incrementalChangesBySale=new Map<string,Row[]>(),historicalChangesBySale=new Map<string,Row[]>()
for(const item of rows(snapshot,'sale_payment_attachments'))if(item.sale_id)add(attachmentsBySale,String(item.sale_id),item)
for(const item of rows(snapshot,'waitlist_entries'))if(item.fulfilled_sale_id)add(waitlistBySale,String(item.fulfilled_sale_id),item)
for(const item of rows(snapshot,'incremental_import_change_log'))if(item.sale_id)add(incrementalChangesBySale,String(item.sale_id),item)
for(const item of rows(snapshot,'historical_logistics_change_log'))if(item.sale_id)add(historicalChangesBySale,String(item.sale_id),item)

const activeAllocationStatuses=new Set(['reserved','shipping','shipped'])
const relevantShipmentStatuses=new Set(['draft','requested','awaiting_customer_approval','customer_approved','label_pending','label_released','posted','delivered'])
const relevantPreparationStatuses=new Set(['draft','awaiting_scan','identified','confirmed'])
const relevantSaleShippingStatuses=new Set(['ENVIADO','POSTADO','EM TRANSITO','EM TRÂNSITO','ENTREGUE','EM SEPARACAO','EM SEPARAÇÃO','EM PREPARACAO','EM PREPARAÇÃO'])

const details=crmOnly.map(sale=>{
 const saleId=String(sale.id)
 const allocations=allocationsBySale.get(saleId)??[]
 const activeAllocations=allocations.filter(allocation=>activeAllocationStatuses.has(String(allocation.status)))
 const shipmentItems=[...new Map([...(shipmentItemsBySale.get(saleId)??[]),...allocations.flatMap(allocation=>shipmentItemsByAllocation.get(String(allocation.id))??[])].map(item=>[String(item.id),item])).values()]
 const shipmentDetails=shipmentItems.map(item=>({...item,shipment:shipments.get(String(item.shipment_id))??null}))
 const relevantShipments=shipmentDetails.filter(item=>item.removed_at==null&&relevantShipmentStatuses.has(String((item.shipment as Row|null)?.status)))
 const preparationDetails=allocations.flatMap(allocation=>(preparationItemsByAllocation.get(String(allocation.id))??[]).map(item=>({...item,batch:preparationBatches.get(String(item.batch_id))??null})))
 const relevantPreparations=preparationDetails.filter(item=>relevantPreparationStatuses.has(String((item.batch as Row|null)?.status)))
 const requestDetails=allocations.flatMap(allocation=>(requestItemsByAllocation.get(String(allocation.id))??[]).map(item=>({...item,request:customerRequests.get(String(item.request_id))??null})))
 const relevantRequests=requestDetails.filter(item=>['requested','converted'].includes(String((item.request as Row|null)?.status)))
 const movements=movementsBySale.get(saleId)??[]
 const blockers:string[]=[]
 if(activeAllocations.length)blockers.push(`active_inventory_allocation:${activeAllocations.length}`)
 if(relevantShipments.length)blockers.push(`relevant_shipment:${relevantShipments.length}`)
 if(relevantPreparations.length)blockers.push(`preparation_dependency:${relevantPreparations.length}`)
 if(relevantRequests.length)blockers.push(`customer_shipment_request:${relevantRequests.length}`)
 if(movements.length)blockers.push(`physical_inventory_movement:${movements.length}`)
 if(sale.shipped_at!=null)blockers.push('sale_shipped_at_present')
 // "DISPONÍVEL" é disponibilidade para envio, não remessa/preparação iniciada.
 if(relevantSaleShippingStatuses.has(String(sale.shipping_operational_status??'').trim().toUpperCase()))blockers.push(`sale_shipping_status:${sale.shipping_operational_status}`)
 const importBatch=sale.import_batch_id?importBatches.get(String(sale.import_batch_id))??null:null
 return{
  classification:blockers.length?'REQUIRES_REVIEW':'SAFE_TO_ARCHIVE',blockers,
  canonical_absence_confirmed:true,canonical_snapshot_sha256:spreadsheetSha256,
  sale_id:saleId,organization_id:String(sale.organization_id),client_id:String(sale.client_id),perfume_id:String(sale.perfume_id),
  client:String(clients.get(String(sale.client_id))?.name??sale.client_name_raw??sale.original_client??''),
  perfume:String(perfumes.get(String(sale.perfume_id))?.full_name_raw??sale.perfume_name_raw??''),
  sale_date:sale.sale_date,sale_type:sale.sale_type,volume_ml:sale.volume_ml,amount:Number(sale.amount),
  payment_status:sale.payment_status,paid_at:sale.paid_at,shipped_at:sale.shipped_at,
  shipping_operational_status:sale.shipping_operational_status,
  inventory_allocation_eligible:sale.inventory_allocation_eligible,
  shipments:shipmentDetails,preparations:preparationDetails,customer_shipment_requests:requestDetails,inventory_allocations:allocations,
  inventory_movements:movements.map(movement=>({...movement,inventory_item:inventoryItems.get(String(movement.inventory_item_id))??null})),
  origin:{source:sale.source,source_file:sale.source_file,source_sheet:sale.source_sheet,source_row:sale.source_row,import_batch_id:sale.import_batch_id,import_batch:importBatch,import_rows:importRowsBySale.get(saleId)??[],incremental_staging:stagingBySale.get(saleId)??[],incremental_changes:incrementalChangesBySale.get(saleId)??[],historical_logistics_changes:historicalChangesBySale.get(saleId)??[]},
  preserved_nonblocking_references:{payment_attachments:attachmentsBySale.get(saleId)??[],fulfilled_waitlist_entries:waitlistBySale.get(saleId)??[]},
  created_at:sale.created_at,updated_at:sale.updated_at,expected_updated_at:sale.updated_at,
 }
})

const safe=details.filter(item=>item.classification==='SAFE_TO_ARCHIVE')
const review=details.filter(item=>item.classification==='REQUIRES_REVIEW')
const manifest=safe.map(item=>({
 sale_id:item.sale_id,organization_id:item.organization_id,expected_updated_at:String(item.expected_updated_at),
 amount:Number(item.amount).toFixed(2),client_id:item.client_id,perfume_id:item.perfume_id,
 sale_date:String(item.sale_date).slice(0,10),sale_type:String(item.sale_type),
 volume_ml:Number(item.volume_ml).toFixed(3),payment_status:String(item.payment_status),
})).sort((left,right)=>left.sale_id.localeCompare(right.sale_id))
const manifestCanonical=manifest.map(item=>[item.sale_id,item.organization_id,item.expected_updated_at,item.amount,item.client_id,item.perfume_id,item.sale_date,item.sale_type,item.volume_ml,item.payment_status].join('|')).join('\n')
const payloadSha256=createHash('sha256').update(manifestCanonical).digest('hex')
const manifestJson=`${JSON.stringify(manifest,null,2)}\n`
const manifestSha256=createHash('sha256').update(manifestJson).digest('hex')
const safeIds=new Set(safe.map(item=>item.sale_id))
const projected=activeSales.filter(sale=>!safeIds.has(String(sale.id)))
const blockerCounts=new Map<string,number>()
for(const item of review)for(const blocker of item.blockers){const kind=blocker.split(':')[0];blockerCounts.set(kind,(blockerCounts.get(kind)??0)+1)}
const report={
 zero_write:true,generated_at:new Date().toISOString(),snapshot_file:latestSnapshot,snapshot_created_at:snapshot.created_at,
 canonical_spreadsheet:{file:spreadsheetPath,sha256:spreadsheetSha256,total_lines:preview.totalRows,total_amount:totals.spreadsheet.gross_sum},
 approved_manifest:{count:manifest.length,amount:money(manifest.reduce((total,item)=>total+moneyCents(item.amount),0)),sha256:manifestSha256,payload_sha256:payloadSha256,canonical_format:'sale_id|organization_id|expected_updated_at|amount(2)|client_id|perfume_id|sale_date|sale_type|volume_ml(3)|payment_status; linhas ordenadas por sale_id'},
 revalidation:{expected_crm_only:346,actual_crm_only:crmOnly.length,amount:sum(crmOnly),all_absent_from_canonical:true},
 groups:{SAFE_TO_ARCHIVE:{count:safe.length,amount:money(safe.reduce((total,item)=>total+moneyCents(item.amount),0))},REQUIRES_REVIEW:{count:review.length,amount:money(review.reduce((total,item)=>total+moneyCents(item.amount),0))}},
 dependency_counts:Object.fromEntries([...blockerCounts.entries()].sort()),
 current_crm:{active:{count:activeSales.length,amount:sum(activeSales)},financial:groupFinancial(activeSales)},
 projected_after_safe_archive:{active:{count:projected.length,amount:sum(projected)},financial:groupFinancial(projected),difference_vs_canonical:money(moneyCents(totals.spreadsheet.gross_sum)-moneyCents(sum(projected)))},
 unresolved_reconciliation:{
  MATCHED_DIFFERENT_AMOUNT:totals.categories.MATCHED_DIFFERENT_AMOUNT,
  SPREADSHEET_ONLY:totals.categories.SPREADSHEET_ONLY,
  DUPLICATE_CANDIDATE:totals.categories.DUPLICATE_CANDIDATE,
  INVALID:totals.categories.INVALID,
  CRM_ONLY_REQUIRES_REVIEW:{count:review.length,spreadsheet_sum:0,crm_count:review.length,crm_sum:money(review.reduce((total,item)=>total+moneyCents(item.amount),0)),difference:money(-review.reduce((total,item)=>total+moneyCents(item.amount),0))},
 },
 details,
}

const output=join('private_data',`crm-only-archive-dry-run-${spreadsheetSha256.slice(0,12)}.json`)
const manifestOutput=join('private_data',`canonical-davi-sales-archive-manifest-${spreadsheetSha256.slice(0,12)}.json`)
writeFileSync(output,JSON.stringify(report,null,2))
writeFileSync(manifestOutput,manifestJson)
console.log(JSON.stringify({...report,details:undefined,report_file:output,manifest_file:manifestOutput},null,2))
