import {readWorkbook} from './importer'
import {authenticatedOrganization} from './records'
import {supabase} from './supabase'
// @ts-expect-error O motor é ESM puro compartilhado com os scripts Node.
import {analyzeCurrentCrm,analyzeDaviImport,stageDaviParsedRows} from '../../scripts/davi-import-diagnostics-lib.mjs'

export type DaviDiagnosticCandidate={sale_id:string;client_id:string;client:string;perfume_id:string;perfume:string;date:string;type:string;ml:number;amount:number}
export type DaviDiagnosticRow={source_row:number;client:string;perfume:string;type:string;ml:number|null;amount:number|null;date:string|null;identity_classification:'EXACT_EXISTING'|'PROBABLE_DUPLICATE'|'NEW_SALE'|'CONFLICT'|'INVALID';sale_id:string|null;candidate_sale_ids:string[];existing_matches?:DaviDiagnosticCandidate[];reason:string;confidence:number;action:string;stock_classification:'STOCK_OK'|'STOCK_INSUFFICIENT'|'STOCK_ITEM_MISSING'|'STOCK_NOT_REQUIRED'|null;stock_reason:string;inventory:Record<string,number|string|null>|null;proposed_changes:Record<string,unknown>}
export type DaviDiagnosticReport={zero_write:true;total_lines:number;identity:{new_sales:number;updates:number;updates_with_changes:number;probable_duplicates:number;conflicts:number;invalid:number};stock:{stock_ok:{sales:number;ml:number};stock_insufficient:{sales:number;ml:number};stock_item_missing:{sales:number;ml:number};stock_not_required:number;excluded_for_manual_review:number;perfumes_with_deficit:number;total_deficit_ml:number};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;already_reserved_ml:number;new_demand_ml:number;projected_balance_ml:number;deficit_ml:number;surplus_ml:number}[];rows:DaviDiagnosticRow[];file_name:string}
export type CrmFinding={id:string;code:string;severity:'CRITICAL'|'WARNING'|'REVIEW'|'INFO';category:'duplicates'|'perfumes'|'inventory'|'references'|'commercial';sale_id:string|null;title:string;reason:string;expected:unknown;actual:unknown;related_entities:Record<string,unknown>}
export type CurrentCrmDiagnostic={zero_write:true;mode:'current_crm';organization_id:string;created_at:string;analyzed:{sales:number;clients:number;perfumes:number;inventory_items:number;inventory_allocations:number};severity:Record<'CRITICAL'|'WARNING'|'REVIEW'|'INFO',number>;category:Record<'duplicates'|'perfumes'|'inventory'|'references'|'commercial',number>;summary:{possible_duplicates:number;possible_aliases:number;perfume_conflicts:number;sales_without_item:number;paid_without_allocation:number;incompatible_allocations:number;perfumes_with_projected_deficit:number;reference_inconsistencies:number;value_conflicts:number;commercial_incompatibilities:number};consistency:{changed_during_read:boolean;signature?:string};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;reserved_ml:number;unallocated_demand_ml:number;projected_balance_ml:number;deficit_ml:number}[];findings:CrmFinding[]}

async function allRows(table:string,columns:string,organizationId:string){
  const rows:Record<string,unknown>[]=[]
  for(let from=0;;from+=1000){
    const{data,error}=await supabase!.from(table).select(columns).eq('organization_id',organizationId).order('id').range(from,from+999)
    if(error)throw new Error(`Não foi possível ler ${table} para a análise.`)
    const page=(data??[]) as unknown as Record<string,unknown>[]
    rows.push(...page)
    if((data?.length??0)<1000)break
  }
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Paginação inconsistente em ${table}. Execute novamente.`)
  return rows
}

async function childRows(table:string,columns:string,foreignKey:string,ids:string[]){
 const rows:Record<string,unknown>[]=[]
 for(let index=0;index<ids.length;index+=100){const chunk=ids.slice(index,index+100);for(let from=0;;from+=1000){const{data,error}=await supabase!.from(table).select(columns).in(foreignKey,chunk).order('id').range(from,from+999);if(error)throw new Error(`Não foi possível ler ${table} para a análise.`);const page=(data??[])as unknown as Record<string,unknown>[];rows.push(...page);if(page.length<1000)break}}
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Paginação inconsistente em ${table}. Execute novamente.`)
 return rows
}

const latest=(rows:Record<string,unknown>[])=>rows.map(row=>String(row.updated_at??'')).sort().at(-1)??''
async function endMarker(table:string,organizationId:string){const{data,count,error}=await supabase!.from(table).select('id,updated_at',{count:'exact'}).eq('organization_id',organizationId).order('updated_at',{ascending:false}).limit(1);if(error)throw new Error(`Não foi possível confirmar a consistência de ${table}.`);return{count:count??0,latest:String((data?.[0]as{updated_at?:string}|undefined)?.updated_at??'')}}

async function fetchDiagnosticSnapshot(organizationId:string){
 const[clients,perfumes,sales,inventoryItems,inventoryAllocations,shipments,shipmentItems,preparationBatches]=await Promise.all([
  allRows('clients','id,organization_id,name,deleted_at',organizationId),
  allRows('perfumes','id,organization_id,full_name_raw,normalized_name,base_name',organizationId),
  allRows('sales','id,organization_id,client_id,perfume_id,sale_date,sale_type,volume_ml,amount,payment_status,payment_method,paid_at,shipped_at,shipping_operational_status,client_name_raw,original_client,perfume_name_raw,original_amount,raw_data,inventory_allocation_eligible,operational_created_at,updated_at,deleted_at',organizationId),
  allRows('inventory_items','id,organization_id,perfume_id,reference_date,available_ml,physical_ml,status,updated_at',organizationId),
  allRows('inventory_allocations','id,organization_id,inventory_item_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,status,allocation_source,stock_managed,shipment_id,updated_at',organizationId),
  allRows('shipments','id,organization_id,status,updated_at',organizationId),
  allRows('shipment_items','id,organization_id,shipment_id,allocation_id,sale_id,quantity_ml,removed_at',organizationId),
  allRows('preparation_batches','id,organization_id,status,updated_at',organizationId),
 ])
 const preparationItems=await childRows('preparation_batch_items','id,batch_id,allocation_id,quantity_ml','batch_id',preparationBatches.map(row=>String(row.id)))
 const[afterSales,afterItems,afterAllocations]=await Promise.all([endMarker('sales',organizationId),endMarker('inventory_items',organizationId),endMarker('inventory_allocations',organizationId)])
 const before={sales:{count:sales.length,latest:latest(sales)},inventory_items:{count:inventoryItems.length,latest:latest(inventoryItems)},inventory_allocations:{count:inventoryAllocations.length,latest:latest(inventoryAllocations)}}
 const after={sales:afterSales,inventory_items:afterItems,inventory_allocations:afterAllocations}
 const changed=Object.keys(before).some(key=>before[key as keyof typeof before].count!==after[key as keyof typeof after].count||before[key as keyof typeof before].latest!==after[key as keyof typeof after].latest)
 return{organization_id:organizationId,consistency:{changed_during_read:changed,signature:JSON.stringify({before,after})},tables:{clients,perfumes,sales,inventory_items:inventoryItems,inventory_allocations:inventoryAllocations,shipments,shipment_items:shipmentItems,preparation_batches:preparationBatches,preparation_batch_items:preparationItems}}
}

export async function analyzeDaviFile(file:File):Promise<DaviDiagnosticReport>{
  if(!supabase)throw new Error('Conecte o Supabase para analisar a planilha.')
  const[{preview},{organizationId}]=await Promise.all([readWorkbook(file),authenticatedOrganization()])
  const snapshot=await fetchDiagnosticSnapshot(organizationId)
  const staging=stageDaviParsedRows(preview.rows,snapshot)
  return{...analyzeDaviImport({staging,snapshot}),file_name:file.name}as DaviDiagnosticReport
}

export async function analyzeCurrentCrmState():Promise<CurrentCrmDiagnostic>{
 if(!supabase)throw new Error('Conecte o Supabase para verificar o CRM.')
 const{organizationId}=await authenticatedOrganization(),snapshot=await fetchDiagnosticSnapshot(organizationId)
 return analyzeCurrentCrm(snapshot,{organizationId})as CurrentCrmDiagnostic
}

export const safeDaviRows=(report:DaviDiagnosticReport)=>report.rows.filter(row=>
  (row.identity_classification==='NEW_SALE'||(row.identity_classification==='EXACT_EXISTING'&&Object.keys(row.proposed_changes).length>0))
  &&['STOCK_OK','STOCK_NOT_REQUIRED'].includes(row.stock_classification??''))
