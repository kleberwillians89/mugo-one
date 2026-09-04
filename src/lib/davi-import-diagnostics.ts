import {ImportPreview,readWorkbook} from './importer'
import {authenticatedOrganization} from './records'
import {supabase} from './supabase'
// @ts-expect-error O motor é ESM puro compartilhado com os scripts Node.
import {analyzeCurrentCrm,analyzeDaviImport,stageDaviParsedRows} from '../../scripts/davi-import-diagnostics-lib.mjs'

export type DaviDiagnosticCandidate={sale_id:string;client_id:string;client:string;perfume_id:string;perfume:string;date:string;type:string;ml:number;amount:number}
export type DaviDiagnosticRow={source_row:number;client:string;perfume:string;type:string;ml:number|null;amount:number|null;date:string|null;identity_classification:'EXACT_EXISTING'|'PROBABLE_DUPLICATE'|'NEW_SALE'|'CONFLICT'|'INVALID';sale_id:string|null;candidate_sale_ids:string[];existing_matches?:DaviDiagnosticCandidate[];reason:string;confidence:number;action:string;stock_classification:'STOCK_OK'|'STOCK_INSUFFICIENT'|'STOCK_ITEM_MISSING'|'STOCK_NOT_REQUIRED'|null;stock_reason:string;inventory:Record<string,number|string|null>|null;proposed_changes:Record<string,unknown>}
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
export type DaviDiagnosticReport={zero_write:true;total_lines:number;identity:{new_sales:number;updates:number;updates_with_changes:number;probable_duplicates:number;conflicts:number;invalid:number};stock:{stock_ok:{sales:number;ml:number};stock_insufficient:{sales:number;ml:number};stock_item_missing:{sales:number;ml:number};stock_not_required:number;excluded_for_manual_review:number;perfumes_with_deficit:number;total_deficit_ml:number};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;already_reserved_ml:number;new_demand_ml:number;projected_balance_ml:number;deficit_ml:number;surplus_ml:number}[];rows:DaviDiagnosticRow[];totals:DaviTotalsReconciliation;data_warnings:DataWarning[];file_name:string}
export type CrmFinding={id:string;code:string;severity:'CRITICAL'|'WARNING'|'REVIEW'|'INFO';category:'duplicates'|'perfumes'|'inventory'|'references'|'commercial';sale_id:string|null;title:string;reason:string;expected:unknown;actual:unknown;related_entities:Record<string,unknown>}
export type CurrentCrmDiagnostic={zero_write:true;mode:'current_crm';organization_id:string;created_at:string;analyzed:{sales:number;clients:number;perfumes:number;inventory_items:number;inventory_allocations:number};severity:Record<'CRITICAL'|'WARNING'|'REVIEW'|'INFO',number>;category:Record<'duplicates'|'perfumes'|'inventory'|'references'|'commercial',number>;summary:{possible_duplicates:number;possible_aliases:number;perfume_conflicts:number;sales_without_item:number;paid_without_allocation:number;incompatible_allocations:number;perfumes_with_projected_deficit:number;reference_inconsistencies:number;value_conflicts:number;commercial_incompatibilities:number};consistency:{changed_during_read:boolean;signature?:string};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;reserved_ml:number;unallocated_demand_ml:number;projected_balance_ml:number;deficit_ml:number}[];findings:CrmFinding[];data_warnings:DataWarning[]}

/** Extrai code/message/details/hint reais do Postgres/PostgREST — nunca escondidos, só reformatados para uma mensagem amigável. */
function describeSupabaseError(table:string,error:{code?:string;message?:string;details?:string;hint?:string}):DataWarning{
  return {table,code:error.code,message:error.message??'Erro desconhecido',details:error.details,hint:error.hint}
}

async function allRows(table:string,columns:string,organizationId:string){
  const rows:Record<string,unknown>[]=[]
  for(let from=0;;from+=1000){
    const{data,error}=await supabase!.from(table).select(columns).eq('organization_id',organizationId).order('id').range(from,from+999)
    if(error){
      const detail=describeSupabaseError(table,error)
      console.error(`[davi-import-diagnostics] Erro Supabase ao ler ${table}: code=${detail.code} message=${detail.message} details=${detail.details} hint=${detail.hint}`)
      throw new Error(`Não foi possível ler ${table} para a análise.`,{cause:detail})
    }
    const page=(data??[]) as unknown as Record<string,unknown>[]
    rows.push(...page)
    if((data?.length??0)<1000)break
  }
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
 for(let index=0;index<ids.length;index+=100){const chunk=ids.slice(index,index+100);for(let from=0;;from+=1000){const{data,error}=await supabase!.from(table).select(columns).in(foreignKey,chunk).order('id').range(from,from+999);if(error){const detail=describeSupabaseError(table,error);console.error(`[davi-import-diagnostics] Erro Supabase ao ler ${table}: code=${detail.code} message=${detail.message} details=${detail.details} hint=${detail.hint}`);throw new Error(`Não foi possível ler ${table} para a análise.`,{cause:detail})};const page=(data??[])as unknown as Record<string,unknown>[];rows.push(...page);if(page.length<1000)break}}
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Paginação inconsistente em ${table}. Execute novamente.`)
 return rows
}

const latest=(rows:Record<string,unknown>[])=>rows.map(row=>String(row.updated_at??'')).sort().at(-1)??''
async function endMarker(table:string,organizationId:string){const{data,count,error}=await supabase!.from(table).select('id,updated_at',{count:'exact'}).eq('organization_id',organizationId).order('updated_at',{ascending:false}).limit(1);if(error)throw new Error(`Não foi possível confirmar a consistência de ${table}.`);return{count:count??0,latest:String((data?.[0]as{updated_at?:string}|undefined)?.updated_at??'')}}

async function fetchDiagnosticSnapshot(organizationId:string){
 const[clients,perfumes,sales,inventoryItems,inventoryAllocations,shipments,shipmentItems,preparationBatchesRead]=await Promise.all([
  allRows('clients','id,organization_id,name,deleted_at',organizationId),
  allRows('perfumes','id,organization_id,full_name_raw,normalized_name,base_name',organizationId),
  allRows('sales','id,organization_id,client_id,perfume_id,sale_date,sale_type,volume_ml,amount,payment_status,payment_method,paid_at,shipped_at,shipping_operational_status,client_name_raw,original_client,perfume_name_raw,original_amount,raw_data,inventory_allocation_eligible,operational_created_at,updated_at,deleted_at',organizationId),
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
 const preparationItems=await childRows('preparation_batch_items','id,batch_id,allocation_id,quantity_ml','batch_id',preparationBatches.map(row=>String(row.id)))
 const[afterSales,afterItems,afterAllocations]=await Promise.all([endMarker('sales',organizationId),endMarker('inventory_items',organizationId),endMarker('inventory_allocations',organizationId)])
 const before={sales:{count:sales.length,latest:latest(sales)},inventory_items:{count:inventoryItems.length,latest:latest(inventoryItems)},inventory_allocations:{count:inventoryAllocations.length,latest:latest(inventoryAllocations)}}
 const after={sales:afterSales,inventory_items:afterItems,inventory_allocations:afterAllocations}
 const changed=Object.keys(before).some(key=>before[key as keyof typeof before].count!==after[key as keyof typeof after].count||before[key as keyof typeof before].latest!==after[key as keyof typeof after].latest)
 return{organization_id:organizationId,consistency:{changed_during_read:changed,signature:JSON.stringify({before,after})},data_warnings:dataWarnings,tables:{clients,perfumes,sales,inventory_items:inventoryItems,inventory_allocations:inventoryAllocations,shipments,shipment_items:shipmentItems,preparation_batches:preparationBatches,preparation_batch_items:preparationItems}}
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
  const[{preview},{organizationId}]=await Promise.all([readWorkbook(file),authenticatedOrganization()])
  const snapshot=await fetchDiagnosticSnapshot(organizationId)
  const staging=stageDaviParsedRows(preview.rows,snapshot)
  const analysis=analyzeDaviImport({staging,snapshot})
  const totals=computeTotals(preview,analysis.rows,snapshot.tables.sales)
  return{...analysis,totals,data_warnings:snapshot.data_warnings,file_name:file.name}as DaviDiagnosticReport
}

export async function analyzeCurrentCrmState():Promise<CurrentCrmDiagnostic>{
 if(!supabase)throw new Error('Conecte o Supabase para verificar o CRM.')
 const{organizationId}=await authenticatedOrganization(),snapshot=await fetchDiagnosticSnapshot(organizationId)
 return {...analyzeCurrentCrm(snapshot,{organizationId}),data_warnings:snapshot.data_warnings}as CurrentCrmDiagnostic
}

export const safeDaviRows=(report:DaviDiagnosticReport)=>report.rows.filter(row=>
  (row.identity_classification==='NEW_SALE'||(row.identity_classification==='EXACT_EXISTING'&&Object.keys(row.proposed_changes).length>0))
  &&['STOCK_OK','STOCK_NOT_REQUIRED'].includes(row.stock_classification??''))
