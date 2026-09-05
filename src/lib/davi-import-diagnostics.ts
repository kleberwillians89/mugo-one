import {ImportPreview,readWorkbook} from './importer'
import {authenticatedOrganization} from './records'
import {supabase} from './supabase'
import {OPERATIONAL_START_DATE} from './operational-sales'
// @ts-expect-error O motor é ESM puro compartilhado com os scripts Node.
import {analyzeCurrentCrm,analyzeDaviImport,safeDaviDiagnosticRows,stageDaviParsedRows} from '../../scripts/davi-import-diagnostics-lib.mjs'

export type DaviDiagnosticCandidate={sale_id:string;client_id:string;client:string;perfume_id:string;perfume:string;date:string;type:string;ml:number;amount:number}
export type DaviDiagnosticRow={source_row:number;client:string;perfume:string;type:string;ml:number|null;amount:number|null;date:string|null;identity_classification:'EXACT_EXISTING'|'PROBABLE_DUPLICATE'|'NEW_SALE'|'CONFLICT'|'INVALID';diagnostic_status?:'COMPLETE'|'INCOMPLETE_DIAGNOSTIC';sale_id:string|null;candidate_sale_ids:string[];existing_matches?:DaviDiagnosticCandidate[];reason:string;confidence:number;action:string;stock_classification:'STOCK_OK'|'STOCK_INSUFFICIENT'|'STOCK_ITEM_MISSING'|'STOCK_NOT_REQUIRED'|null;stock_reason:string;inventory:Record<string,number|string|null>|null;proposed_changes:Record<string,unknown>;organization_id?:string|null;source_signature?:string|null;expected_updated_at?:string|null;resolved_client_id?:string|null;normalized_client?:string;resolved_perfume_id?:string|null;normalized_perfume?:string;payment_status?:string;payment_method?:string|null;paid_at?:string|null;shipped_at?:string|null;credit?:number|null;note?:string|null;split_completed_at?:string|null;expected_payment_status?:string|null;expected_payment_method?:string|null;expected_paid_at?:string|null;expected_shipped_at?:string|null;expected_credit?:number|null;expected_note?:string|null;expected_split_completed_at?:string|null;approved_new_decision?:string|null}
export type DataWarning={table:string;code?:string;message:string;details?:string;hint?:string}
export type StatusAmount={count:number;sum:number}
export type DaviReconciliationCategory='MATCHED_SAME_AMOUNT'|'MATCHED_DIFFERENT_AMOUNT'|'SPREADSHEET_ONLY'|'CRM_ONLY'|'DUPLICATE_CANDIDATE'|'INVALID'
export type DaviRowDivergence={source_row:number|null;sale_id:string|null;client:string;perfume:string;spreadsheet_amount:number|null;crm_amount:number|null;difference:number|null;category:DaviReconciliationCategory;reason:string;candidate_sale_ids:string[]}
export type DaviCategoryAmount={count:number;spreadsheet_sum:number;crm_count:number;crm_sum:number;difference:number}
export type DaviTotalsReconciliation={
  spreadsheet:{total_lines:number;valid_commercial_lines:number;gross_sum:number;sum_excluding_cancelled:number;by_status:Record<string,StatusAmount>;lines_without_value:number;lines_invalid_value:number;duplicate_value_candidates:number}
  crm:{corresponding:StatusAmount;duplicate_candidates:StatusAmount;crm_only:StatusAmount;overview:{total_general:StatusAmount;paid:StatusAmount;pending:StatusAmount;cancelled:StatusAmount;excluded_deleted:StatusAmount;historical_ineligible:StatusAmount;other_status:StatusAmount}}
  differences:{spreadsheet_vs_corresponding:number;spreadsheet_vs_total_crm:number}
  categories:Record<DaviReconciliationCategory,DaviCategoryAmount>
  bridges:{spreadsheet_vs_corresponding:number;spreadsheet_vs_total_crm:number}
  reconciles:{spreadsheet_vs_corresponding:boolean;spreadsheet_vs_total_crm:boolean}
  divergences:DaviRowDivergence[]
}
export type DaviDiagnosticReport={zero_write:true;organization_id:string;source_sha256:string;total_lines:number;identity:{new_sales:number;updates:number;updates_with_changes:number;probable_duplicates:number;conflicts:number;invalid:number};stock:{stock_ok:{sales:number;ml:number};stock_insufficient:{sales:number;ml:number};stock_item_missing:{sales:number;ml:number};stock_not_required:number;excluded_for_manual_review:number;perfumes_with_deficit:number;total_deficit_ml:number};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;already_reserved_ml:number;new_demand_ml:number;projected_balance_ml:number;deficit_ml:number;surplus_ml:number}[];rows:DaviDiagnosticRow[];totals:DaviTotalsReconciliation;data_warnings:DataWarning[];file_name:string;snapshot_complete:boolean;snapshot_signature:string;snapshot_created_at:string}
export type CrmFinding={id:string;code:string;severity:'CRITICAL'|'WARNING'|'REVIEW'|'INFO';category:'duplicates'|'perfumes'|'inventory'|'references'|'commercial';sale_id:string|null;title:string;reason:string;expected:unknown;actual:unknown;related_entities:Record<string,unknown>}
export type CurrentCrmDiagnostic={zero_write:true;mode:'current_crm';organization_id:string;created_at:string;analyzed:{sales:number;clients:number;perfumes:number;inventory_items:number;inventory_allocations:number};severity:Record<'CRITICAL'|'WARNING'|'REVIEW'|'INFO',number>;category:Record<'duplicates'|'perfumes'|'inventory'|'references'|'commercial',number>;summary:{possible_duplicates:number;possible_aliases:number;perfume_conflicts:number;sales_without_item:number;paid_without_allocation:number;incompatible_allocations:number;perfumes_with_projected_deficit:number;reference_inconsistencies:number;value_conflicts:number;commercial_incompatibilities:number};consistency:{changed_during_read:boolean;signature?:string};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;reserved_ml:number;unallocated_demand_ml:number;projected_balance_ml:number;deficit_ml:number}[];findings:CrmFinding[];data_warnings:DataWarning[]}
export type DaviSafeApplyCandidate={identity_classification:'NEW_SALE'|'EXACT_EXISTING';source_row:number;source_signature:string;sale_id:string|null;expected_updated_at:string|null;resolved_client_id:string|null;client:string;display_client:string;resolved_perfume_id:string|null;perfume:string;display_perfume:string;sale_date:string;sale_type:string;volume_ml:string;amount:string;payment_status:string;payment_method:string|null;paid_at:string|null;shipped_at:string|null;credit:string|null;note:string|null;split_completed_at:string|null;expected_payment_status:string|null;expected_payment_method:string|null;expected_paid_at:string|null;expected_shipped_at:string|null;expected_credit:string|null;expected_note:string|null;expected_split_completed_at:string|null;change_keys:string[];stock_classification:'STOCK_OK'|'STOCK_NOT_REQUIRED';inventory_item_id:string|null;required_inventory_ml:string;approved_new_decision:string|null;reason:string;confidence:string}
export type DaviSafeApplyResult={batch_id:string;idempotent:boolean;updates:number;inserts:number;applied:number;fingerprint:string}

/** Extrai code/message/details/hint reais do Postgres/PostgREST — nunca escondidos, só reformatados para uma mensagem amigável. */
function describeSupabaseError(table:string,error:{code?:string;message?:string;details?:string;hint?:string}):DataWarning{
  return {table,code:error.code,message:error.message??'Erro desconhecido',details:error.details,hint:error.hint}
}

async function allRows(table:string,columns:string,organizationId:string,minimumSaleDate?:string){
  const rows:Record<string,unknown>[]=[]
  let expectedCount:number|null=null
  for(let from=0;;from+=1000){
    let query=supabase!.from(table).select(columns,{count:'exact'}).eq('organization_id',organizationId)
    if(minimumSaleDate)query=query.gte('sale_date',minimumSaleDate)
    const{data,count,error}=await query.order('id').range(from,from+999)
    if(error){
      const detail=describeSupabaseError(table,error)
      console.error(`[davi-import-diagnostics] Erro Supabase ao ler ${table}: code=${detail.code} message=${detail.message} details=${detail.details} hint=${detail.hint}`)
      throw new Error(`Não foi possível ler ${table} para a análise.`,{cause:detail})
    }
    const page=(data??[]) as unknown as Record<string,unknown>[]
    if(count==null)throw new Error(`Não foi possível confirmar a contagem de ${table} para a análise.`)
    expectedCount??=count
    rows.push(...page)
    if((data?.length??0)<1000)break
  }
  if(expectedCount!==rows.length)throw new Error(`Paginação incompleta em ${table}: esperado ${expectedCount}, coletado ${rows.length}.`)
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Paginação inconsistente em ${table}. Execute novamente.`)
  return rows
}

/** Igual a allRows, mas não aborta o diagnóstico: tabelas complementares (ex.: preparation_batches) voltam vazias em falha, com o erro real do Supabase preservado em data_warnings. */
export async function optionalDiagnosticRows(table:string,reader:()=>Promise<Record<string,unknown>[]>):Promise<{rows:Record<string,unknown>[];warning:DataWarning|null}>{
  try{ return {rows:await reader(),warning:null} }
  catch(reason){
    const cause=reason instanceof Error?reason.cause as DataWarning|undefined:undefined
    return {rows:[],warning:cause??{table,message:reason instanceof Error?reason.message:'Erro desconhecido'}}
  }
}

async function allRowsOptional(table:string,columns:string,organizationId:string){
 return optionalDiagnosticRows(table,()=>allRows(table,columns,organizationId))
}

async function childRows(table:string,columns:string,foreignKey:string,ids:string[]){
 const rows:Record<string,unknown>[]=[]
 for(let index=0;index<ids.length;index+=100){const chunk=ids.slice(index,index+100);let expectedCount:number|null=null;let chunkRows=0;for(let from=0;;from+=1000){const{data,count,error}=await supabase!.from(table).select(columns,{count:'exact'}).in(foreignKey,chunk).order('id').range(from,from+999);if(error){const detail=describeSupabaseError(table,error);console.error(`[davi-import-diagnostics] Erro Supabase ao ler ${table}: code=${detail.code} message=${detail.message} details=${detail.details} hint=${detail.hint}`);throw new Error(`Não foi possível ler ${table} para a análise.`,{cause:detail})};if(count==null)throw new Error(`Não foi possível confirmar a contagem de ${table} para a análise.`);expectedCount??=count;const page=(data??[])as unknown as Record<string,unknown>[];chunkRows+=page.length;rows.push(...page);if(page.length<1000)break}if(expectedCount!==chunkRows)throw new Error(`Paginação incompleta em ${table}: esperado ${expectedCount}, coletado ${chunkRows}.`)}
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Paginação inconsistente em ${table}. Execute novamente.`)
 return rows
}

const latest=(rows:Record<string,unknown>[])=>rows.map(row=>String(row.updated_at??'')).sort().at(-1)??''
async function endMarker(table:string,organizationId:string,minimumSaleDate?:string){let query=supabase!.from(table).select('id,updated_at',{count:'exact'}).eq('organization_id',organizationId);if(minimumSaleDate)query=query.gte('sale_date',minimumSaleDate);const{data,count,error}=await query.order('updated_at',{ascending:false}).limit(1);if(error)throw new Error(`Não foi possível confirmar a consistência de ${table}.`);return{count:count??0,latest:String((data?.[0]as{updated_at?:string}|undefined)?.updated_at??'')}}

async function fetchDiagnosticSnapshot(organizationId:string){
 const[clients,perfumes,sales,inventoryItems,inventoryAllocations,shipments,shipmentItems,preparationBatchesRead]=await Promise.all([
  allRows('clients','id,organization_id,name,deleted_at',organizationId),
  allRows('perfumes','id,organization_id,full_name_raw,normalized_name,base_name',organizationId),
  allRows('sales','id,organization_id,client_id,perfume_id,sale_date,sale_type,volume_ml,amount,payment_status,payment_method,paid_at,shipped_at,shipping_operational_status,client_name_raw,original_client,perfume_name_raw,original_amount,raw_data,inventory_allocation_eligible,operational_created_at,updated_at,deleted_at',organizationId,OPERATIONAL_START_DATE),
  allRows('inventory_items','id,organization_id,perfume_id,reference_date,available_ml,physical_ml,status,updated_at',organizationId),
  allRows('inventory_allocations','id,organization_id,inventory_item_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,status,allocation_source,stock_managed,shipment_id,updated_at',organizationId),
  allRows('shipments','id,organization_id,status,updated_at',organizationId),
  allRows('shipment_items','id,organization_id,shipment_id,allocation_id,sale_id,quantity_ml,removed_at',organizationId),
  // preparation_batches é complementar a analyzeCurrentCrm (só alimenta 2 findings de estoque) e nunca teve coluna updated_at —
  // pedi-la sempre gerava erro Postgres 42703 (coluna inexistente) que abortava TODO o diagnóstico via este Promise.all.
  // Leitura opcional: falha aqui nunca derruba vendas/estoque/alocações; o erro real fica em data_warnings.
  allRowsOptional('preparation_batches','id,organization_id,status',organizationId),
 ])
 const preparationBatches=preparationBatchesRead.rows
 const dataWarnings:DataWarning[]=preparationBatchesRead.warning?[preparationBatchesRead.warning]:[]
 const incompleteTables=preparationBatchesRead.warning?['preparation_batches']:[]
 const preparationItems=await childRows('preparation_batch_items','id,batch_id,allocation_id,quantity_ml','batch_id',preparationBatches.map(row=>String(row.id)))
 const[afterSales,afterItems,afterAllocations]=await Promise.all([endMarker('sales',organizationId,OPERATIONAL_START_DATE),endMarker('inventory_items',organizationId),endMarker('inventory_allocations',organizationId)])
 const before={sales:{count:sales.length,latest:latest(sales)},inventory_items:{count:inventoryItems.length,latest:latest(inventoryItems)},inventory_allocations:{count:inventoryAllocations.length,latest:latest(inventoryAllocations)}}
 const after={sales:afterSales,inventory_items:afterItems,inventory_allocations:afterAllocations}
 const changed=Object.keys(before).some(key=>before[key as keyof typeof before].count!==after[key as keyof typeof after].count||before[key as keyof typeof before].latest!==after[key as keyof typeof after].latest)
 return{organization_id:organizationId,snapshot_created_at:new Date().toISOString(),consistency:{changed_during_read:changed,incomplete_tables:incompleteTables,signature:JSON.stringify({before,after})},data_warnings:dataWarnings,tables:{clients,perfumes,sales,inventory_items:inventoryItems,inventory_allocations:inventoryAllocations,shipments,shipment_items:shipmentItems,preparation_batches:preparationBatches,preparation_batch_items:preparationItems}}
}

const toCents=(value:unknown)=>{const number=Number(value);return value==null||!Number.isFinite(number)?0:Math.round(number*100)}
const fromCents=(value:number)=>value/100
const centsSum=(list:{amount:number|null}[])=>list.reduce((total,item)=>total+toCents(item.amount),0)
const statusAmount=(list:{amount:number|null}[]):StatusAmount=>({count:list.length,sum:fromCents(centsSum(list))})

/**
 * Reconciliação de totais (Planilha × CRM) sobre o resultado já calculado por analyzeDaviImport —
 * não reclassifica nada: só agrega por identity_classification, que já usa o mesmo parser e o
 * mesmo motor de identidade comercial da tela ANALISAR NOVA PLANILHA.
 */
export function computeTotals(preview:ImportPreview,rows:DaviDiagnosticRow[],sales:Record<string,unknown>[]):DaviTotalsReconciliation{
 const financialRows=preview.rows.filter(row=>row.amount!==null&&row.amount>=0)
 const byStatus:Record<string,StatusAmount>={}
 for(const status of new Set(financialRows.map(row=>row.paymentStatus))) byStatus[status]=statusAmount(financialRows.filter(row=>row.paymentStatus===status))
 const spreadsheet={
  total_lines:preview.totalRows,valid_commercial_lines:preview.valid,
  gross_sum:fromCents(centsSum(financialRows)),
  sum_excluding_cancelled:statusAmount(financialRows.filter(row=>row.paymentStatus!=='cancelled')).sum,
  by_status:byStatus,
  lines_without_value:preview.rows.filter(row=>row.amount===null).length,
  lines_invalid_value:preview.rows.filter(row=>row.amount!==null&&row.amount<0).length,
  duplicate_value_candidates:preview.duplicates,
 }

 const asSale=(row:Record<string,unknown>)=>({
  id:String(row.id),amount:row.amount==null?null:Number(row.amount),payment_status:String(row.payment_status??''),
  deleted_at:row.deleted_at as string|null,eligible:row.inventory_allocation_eligible,
  client:String(row.client_name_raw??row.original_client??''),perfume:String(row.perfume_name_raw??''),
 })
 const parsedSales=sales.map(asSale)
 const activeSales=parsedSales.filter(sale=>sale.deleted_at==null)
 const activeById=new Map(activeSales.map(sale=>[sale.id,sale]))
 const deletedSales=parsedSales.filter(sale=>sale.deleted_at!=null)
 const paidSales=activeSales.filter(sale=>sale.payment_status==='paid')
 const pendingSales=activeSales.filter(sale=>sale.payment_status==='pending')
 const cancelledSales=activeSales.filter(sale=>sale.payment_status==='cancelled')
 const historicalSales=activeSales.filter(sale=>sale.eligible===false)
 const otherStatusSales=activeSales.filter(sale=>!['paid','pending','cancelled'].includes(sale.payment_status))
 const confirmedSaleIds=new Set<string>(),duplicateSaleIds=new Set<string>()
 const divergences:DaviRowDivergence[]=[]
 const candidateIds=(row:DaviDiagnosticRow)=>[...new Set([row.sale_id,...row.candidate_sale_ids,...(row.existing_matches??[]).map(match=>match.sale_id)].filter((id):id is string=>Boolean(id&&activeById.has(id))))]
 const classify=(row:DaviDiagnosticRow,category:DaviReconciliationCategory,saleId:string|null,ids:string[],reason=row.reason)=>{
  const crmAmount=saleId?activeById.get(saleId)?.amount??null:null
  divergences.push({source_row:row.source_row,sale_id:saleId,client:row.client,perfume:row.perfume,spreadsheet_amount:row.amount,crm_amount:crmAmount,difference:row.amount!=null&&crmAmount!=null?fromCents(toCents(row.amount)-toCents(crmAmount)):null,category,reason,candidate_sale_ids:ids})
 }

 // Primeiro reservamos somente matches já inequívocos no motor principal.
 for(const row of rows.filter(row=>row.identity_classification==='EXACT_EXISTING')){
  const ids=candidateIds(row),saleId=ids.length===1?ids[0]:null
  if(!saleId||confirmedSaleIds.has(saleId)){classify(row,'DUPLICATE_CANDIDATE',null,ids,'A venda candidata já foi consumida por outra linha ou não está disponível.');for(const id of ids)duplicateSaleIds.add(id);continue}
  confirmedSaleIds.add(saleId)
  const same=toCents(row.amount)===toCents(activeById.get(saleId)?.amount)
  classify(row,same?'MATCHED_SAME_AMOUNT':'MATCHED_DIFFERENT_AMOUNT',saleId,ids)
 }
 // Conflitos com exatamente uma venda ainda livre podem explicar diferenças de perfume/valor sem virar merge automático.
 for(const row of rows.filter(row=>row.identity_classification!=='EXACT_EXISTING')){
  const ids=candidateIds(row),available=ids.filter(id=>!confirmedSaleIds.has(id))
  if(row.identity_classification==='CONFLICT'&&ids.length===1&&available.length===1){
   const saleId=available[0];confirmedSaleIds.add(saleId)
   const same=toCents(row.amount)===toCents(activeById.get(saleId)?.amount)
   classify(row,same?'MATCHED_SAME_AMOUNT':'MATCHED_DIFFERENT_AMOUNT',saleId,ids)
  }else if(row.identity_classification==='NEW_SALE')classify(row,'SPREADSHEET_ONLY',null,ids)
  else if(row.identity_classification==='INVALID')classify(row,'INVALID',null,ids)
  else{classify(row,'DUPLICATE_CANDIDATE',null,ids);for(const id of available)duplicateSaleIds.add(id)}
 }
 for(const id of confirmedSaleIds)duplicateSaleIds.delete(id)
 const duplicateCandidateSales=[...duplicateSaleIds].map(id=>activeById.get(id)).filter((sale):sale is NonNullable<typeof sale>=>Boolean(sale))
 const crmOnlySales=activeSales.filter(sale=>!confirmedSaleIds.has(sale.id)&&!duplicateSaleIds.has(sale.id))
 for(const sale of crmOnlySales)divergences.push({source_row:null,sale_id:sale.id,client:sale.client,perfume:sale.perfume,spreadsheet_amount:null,crm_amount:sale.amount,difference:fromCents(-toCents(sale.amount)),category:'CRM_ONLY',reason:'Venda presente no CRM sem correspondência nesta planilha.',candidate_sale_ids:[]})

 const categoryNames:DaviReconciliationCategory[]=['MATCHED_SAME_AMOUNT','MATCHED_DIFFERENT_AMOUNT','SPREADSHEET_ONLY','CRM_ONLY','DUPLICATE_CANDIDATE','INVALID']
 const categories=Object.fromEntries(categoryNames.map(category=>{
  const classified=divergences.filter(row=>row.category===category)
  const sheetCents=classified.reduce((sum,row)=>sum+toCents(row.spreadsheet_amount),0)
  const ids=category==='DUPLICATE_CANDIDATE'?duplicateSaleIds:new Set(classified.map(row=>row.sale_id).filter((id):id is string=>Boolean(id)))
  const crmCents=[...ids].reduce((sum,id)=>sum+toCents(activeById.get(id)?.amount),0)
  return[category,{count:classified.length,spreadsheet_sum:fromCents(sheetCents),crm_count:ids.size,crm_sum:fromCents(crmCents),difference:fromCents(sheetCents-crmCents)}]
 })) as Record<DaviReconciliationCategory,DaviCategoryAmount>
 const correspondingSales=[...confirmedSaleIds].map(id=>activeById.get(id)).filter((sale):sale is NonNullable<typeof sale>=>Boolean(sale))
 const crm={
  corresponding:statusAmount(correspondingSales),duplicate_candidates:statusAmount(duplicateCandidateSales),crm_only:statusAmount(crmOnlySales),
  overview:{total_general:statusAmount(activeSales),paid:statusAmount(paidSales),pending:statusAmount(pendingSales),cancelled:statusAmount(cancelledSales),excluded_deleted:statusAmount(deletedSales),historical_ineligible:statusAmount(historicalSales),other_status:statusAmount(otherStatusSales)},
 }
 const spreadsheetCents=toCents(spreadsheet.gross_sum),correspondingCents=toCents(crm.corresponding.sum),totalCrmCents=toCents(crm.overview.total_general.sum)
 const differences={spreadsheet_vs_corresponding:fromCents(spreadsheetCents-correspondingCents),spreadsheet_vs_total_crm:fromCents(spreadsheetCents-totalCrmCents)}
 const correspondingBridgeCents=toCents(categories.MATCHED_DIFFERENT_AMOUNT.difference)+toCents(categories.SPREADSHEET_ONLY.spreadsheet_sum)+toCents(categories.DUPLICATE_CANDIDATE.spreadsheet_sum)+toCents(categories.INVALID.spreadsheet_sum)
 const overallBridgeCents=categoryNames.reduce((sum,category)=>sum+toCents(categories[category].difference),0)
 const bridges={spreadsheet_vs_corresponding:fromCents(correspondingBridgeCents),spreadsheet_vs_total_crm:fromCents(overallBridgeCents)}
 const reconciles={spreadsheet_vs_corresponding:correspondingBridgeCents===spreadsheetCents-correspondingCents,spreadsheet_vs_total_crm:overallBridgeCents===spreadsheetCents-totalCrmCents}
 return {spreadsheet,crm,differences,categories,bridges,reconciles,divergences}
}

export async function analyzeDaviFile(file:File):Promise<DaviDiagnosticReport>{
  if(!supabase)throw new Error('Conecte o Supabase para analisar a planilha.')
   const[{preview},{organizationId},fileBytes]=await Promise.all([readWorkbook(file),authenticatedOrganization(),file.arrayBuffer()])
  const snapshot=await fetchDiagnosticSnapshot(organizationId)
  const staging=stageDaviParsedRows(preview.rows,snapshot)
  const analysis=analyzeDaviImport({staging,snapshot})
  const totals=computeTotals(preview,analysis.rows,snapshot.tables.sales)
    const source_sha256=await sha256Hex(fileBytes)
    const report={...analysis,organization_id:organizationId,source_sha256,totals,data_warnings:snapshot.data_warnings,file_name:file.name,snapshot_complete:!snapshot.consistency.changed_during_read&&!snapshot.consistency.incomplete_tables?.length,snapshot_signature:snapshot.consistency.signature??'',snapshot_created_at:snapshot.snapshot_created_at??''} as DaviDiagnosticReport
    return{...report,rows:report.rows.map(row=>({...row,diagnostic_status:validateDaviSafeDiagnosticRow(row,report).ok?'COMPLETE':'INCOMPLETE_DIAGNOSTIC'}))}
}

export async function analyzeCurrentCrmState():Promise<CurrentCrmDiagnostic>{
 if(!supabase)throw new Error('Conecte o Supabase para verificar o CRM.')
 const{organizationId}=await authenticatedOrganization(),snapshot=await fetchDiagnosticSnapshot(organizationId)
 return {...analyzeCurrentCrm(snapshot,{organizationId}),data_warnings:snapshot.data_warnings}as CurrentCrmDiagnostic
}

const isSha256=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)
const isUuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const approvedChangeKeys=new Set(['payment_status','payment_method','paid_at','shipped_at','credit','note','split_completed_at'])
export type DaviSafeValidation={ok:true}|{ok:false;reason:string}
export function validateDaviSafeDiagnosticRow(row:DaviDiagnosticRow,report?:DaviDiagnosticReport):DaviSafeValidation{
 if(report&&(!report.snapshot_complete||!isUuid(report.organization_id)||!isSha256(report.source_sha256)||!report.file_name||!report.snapshot_signature||!report.snapshot_created_at))return{ok:false,reason:'Snapshot ou identidade do diagnóstico incompleto.'}
 if(report&&row.organization_id!==report.organization_id)return{ok:false,reason:'Tenant da linha não corresponde ao diagnóstico.'}
 if(!Number.isInteger(row.source_row)||row.source_row<1||!row.source_signature||!row.date||!row.client||!row.perfume||!['APC','SPLIT'].includes(row.type.toUpperCase())||row.ml==null||!Number.isFinite(Number(row.ml))||Number(row.ml)<=0||row.amount==null||!Number.isFinite(Number(row.amount))||Number(row.amount)<0||!row.payment_status||!['paid','pending','cancelled','unknown'].includes(row.payment_status))return{ok:false,reason:'Dados comerciais obrigatórios ausentes ou inválidos.'}
 if(!['NEW_SALE','EXACT_EXISTING'].includes(row.identity_classification)||!['STOCK_OK','STOCK_NOT_REQUIRED'].includes(row.stock_classification??''))return{ok:false,reason:'Classificação comercial ou de estoque não é aplicável.'}
 const changeKeys=Object.keys(row.proposed_changes??{}).sort()
 if(changeKeys.some(key=>!approvedChangeKeys.has(key)))return{ok:false,reason:'Campo proposto não é aplicável.'}
 if(row.identity_classification==='NEW_SALE'&&(row.sale_id||row.expected_updated_at||changeKeys.length>0))return{ok:false,reason:'Payload de venda nova inconsistente.'}
 if(row.identity_classification==='EXACT_EXISTING'&&(!isUuid(row.sale_id)||!row.expected_updated_at||Number.isNaN(Date.parse(row.expected_updated_at))||!isUuid(row.resolved_client_id)||!isUuid(row.resolved_perfume_id)||changeKeys.length===0||!row.expected_payment_status))return{ok:false,reason:'Snapshot esperado da venda existente ausente.'}
 const requiredMl=Number(row.inventory?.needed_ml??0)
 if(!Number.isFinite(requiredMl)||requiredMl<0)return{ok:false,reason:'Demanda de estoque inválida.'}
 if(row.stock_classification==='STOCK_OK'&&(!isUuid(row.inventory?.inventory_item_id)||requiredMl<=0))return{ok:false,reason:'Diagnóstico de estoque incompleto.'}
 if(row.stock_classification==='STOCK_NOT_REQUIRED'&&requiredMl!==0)return{ok:false,reason:'Diagnóstico de estoque inconsistente.'}
 return{ok:true}
}
export const incompleteDaviRows=(report:DaviDiagnosticReport)=>report.rows.filter(row=>safeDaviDiagnosticRows({rows:[row]}).length>0&&!validateDaviSafeDiagnosticRow(row,report).ok)
export const safeDaviRows=(report:DaviDiagnosticReport)=>report.rows.filter(row=>safeDaviDiagnosticRows({rows:[row]}).length>0&&validateDaviSafeDiagnosticRow(row,report).ok) as DaviDiagnosticRow[]

const fixed=(value:number|null|undefined,digits:number)=>value==null?null:Number(value).toFixed(digits)
const sha256Hex=async(value:ArrayBuffer|string)=>{
 const bytes=typeof value==='string'?new TextEncoder().encode(value):value
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
}
const fingerprintFields:(keyof DaviSafeApplyCandidate)[]=['identity_classification','source_row','source_signature','sale_id','expected_updated_at','resolved_client_id','client','display_client','resolved_perfume_id','perfume','display_perfume','sale_date','sale_type','volume_ml','amount','payment_status','payment_method','paid_at','shipped_at','credit','note','split_completed_at','expected_payment_status','expected_payment_method','expected_paid_at','expected_shipped_at','expected_credit','expected_note','expected_split_completed_at','change_keys','stock_classification','inventory_item_id','required_inventory_ml','approved_new_decision','reason','confidence']

export const daviSafeApplyCandidates=(report:DaviDiagnosticReport):DaviSafeApplyCandidate[]=>safeDaviRows(report).map(row=>{
 const validation=validateDaviSafeDiagnosticRow(row,report)
 if(!validation.ok)throw new Error(`Linha ${row.source_row}: ${validation.reason} Execute a análise novamente.`)
 if(!row.source_signature||!row.date||row.ml==null||row.amount==null||!row.payment_status)throw new Error(`Linha ${row.source_row}: diagnóstico seguro incompleto; execute a análise novamente.`)
 return{
  identity_classification:row.identity_classification as 'NEW_SALE'|'EXACT_EXISTING',source_row:row.source_row,source_signature:row.source_signature,
  sale_id:row.sale_id,expected_updated_at:row.expected_updated_at??null,resolved_client_id:row.resolved_client_id??null,
  client:row.normalized_client??row.client,display_client:row.client,resolved_perfume_id:row.resolved_perfume_id??null,
  perfume:row.normalized_perfume??row.perfume,display_perfume:row.perfume,sale_date:row.date,sale_type:row.type.toUpperCase(),
  volume_ml:Number(row.ml).toFixed(3),amount:Number(row.amount).toFixed(2),payment_status:row.payment_status,
  payment_method:row.payment_method??null,paid_at:row.paid_at??null,shipped_at:row.shipped_at??null,credit:fixed(row.credit,2),
  note:row.note??null,split_completed_at:row.split_completed_at??null,expected_payment_status:row.expected_payment_status??null,
  expected_payment_method:row.expected_payment_method??null,expected_paid_at:row.expected_paid_at??null,expected_shipped_at:row.expected_shipped_at??null,
  expected_credit:fixed(row.expected_credit,2),expected_note:row.expected_note??null,expected_split_completed_at:row.expected_split_completed_at??null,
  change_keys:Object.keys(row.proposed_changes).sort(),stock_classification:row.stock_classification as 'STOCK_OK'|'STOCK_NOT_REQUIRED',
  inventory_item_id:row.inventory?.inventory_item_id?String(row.inventory.inventory_item_id):null,
  required_inventory_ml:Number(row.inventory?.needed_ml??0).toFixed(3),approved_new_decision:row.approved_new_decision??null,
  reason:row.reason,confidence:Number(row.confidence).toFixed(3),
 }
}).sort((left,right)=>left.source_row-right.source_row)

export const canonicalDaviSafeCandidates=(rows:DaviSafeApplyCandidate[])=>rows.slice().sort((left,right)=>left.source_row-right.source_row).map(row=>fingerprintFields.map(field=>field==='change_keys'?row.change_keys.join(','):String(row[field]??'')).join('\x1f')).join('\x1e')
export const fingerprintDaviSafeCandidates=(rows:DaviSafeApplyCandidate[])=>sha256Hex(canonicalDaviSafeCandidates(rows))

export async function applySafeDaviDiagnostic(report:DaviDiagnosticReport):Promise<DaviSafeApplyResult>{
 if(!supabase)throw new Error('Conecte o Supabase para aplicar as alterações.')
 const rows=daviSafeApplyCandidates(report)
 if(!rows.length)throw new Error('Nenhuma alteração segura para aplicar.')
 const{organizationId}=await authenticatedOrganization()
 if(organizationId!==report.organization_id)throw new Error('O diagnóstico pertence a outra organização. Execute a análise novamente.')
 const fingerprint=await fingerprintDaviSafeCandidates(rows)
 const{data,error}=await supabase.rpc('apply_davi_safe_diagnostic_batch',{
  p_organization_id:organizationId,p_file_name:report.file_name,p_source_hash:report.source_sha256,p_fingerprint:fingerprint,p_rows:rows,
 })
 if(error)throw new Error(error.message)
 return{...(data as Omit<DaviSafeApplyResult,'fingerprint'>),fingerprint}
}
