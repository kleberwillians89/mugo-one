import {readWorkbook} from './importer'
import {authenticatedOrganization} from './records'
import {supabase} from './supabase'
// @ts-expect-error O motor é ESM puro compartilhado com os scripts Node.
import {analyzeDaviImport,stageDaviParsedRows} from '../../scripts/davi-import-diagnostics-lib.mjs'

export type DaviDiagnosticCandidate={sale_id:string;client_id:string;client:string;perfume_id:string;perfume:string;date:string;type:string;ml:number;amount:number}
export type DaviDiagnosticRow={source_row:number;client:string;perfume:string;type:string;ml:number|null;amount:number|null;date:string|null;identity_classification:'EXACT_EXISTING'|'PROBABLE_DUPLICATE'|'NEW_SALE'|'CONFLICT'|'INVALID';sale_id:string|null;candidate_sale_ids:string[];existing_matches?:DaviDiagnosticCandidate[];reason:string;confidence:number;action:string;stock_classification:'STOCK_OK'|'STOCK_INSUFFICIENT'|'STOCK_ITEM_MISSING'|'STOCK_NOT_REQUIRED'|null;stock_reason:string;inventory:Record<string,number|string|null>|null;proposed_changes:Record<string,unknown>}
export type DaviDiagnosticReport={zero_write:true;total_lines:number;identity:{new_sales:number;updates:number;updates_with_changes:number;probable_duplicates:number;conflicts:number;invalid:number};stock:{stock_ok:{sales:number;ml:number};stock_insufficient:{sales:number;ml:number};stock_item_missing:{sales:number;ml:number};stock_not_required:number;excluded_for_manual_review:number;perfumes_with_deficit:number;total_deficit_ml:number};inventory_by_perfume:{inventory_item_id:string;perfume_id:string;perfume:string;available_ml:number;already_reserved_ml:number;new_demand_ml:number;projected_balance_ml:number;deficit_ml:number;surplus_ml:number}[];rows:DaviDiagnosticRow[];file_name:string}

async function allRows(table:string,columns:string,organizationId:string){
  const rows:Record<string,unknown>[]=[]
  for(let from=0;;from+=1000){
    const{data,error}=await supabase!.from(table).select(columns).eq('organization_id',organizationId).order('id').range(from,from+999)
    if(error)throw new Error(`Não foi possível ler ${table} para a análise.`)
    rows.push(...((data??[]) as unknown as Record<string,unknown>[]))
    if((data?.length??0)<1000)break
  }
  return rows
}

export async function analyzeDaviFile(file:File):Promise<DaviDiagnosticReport>{
  if(!supabase)throw new Error('Conecte o Supabase para analisar a planilha.')
  const[{preview},{organizationId}]=await Promise.all([readWorkbook(file),authenticatedOrganization()])
  const[clients,perfumes,sales,inventoryItems,inventoryAllocations]=await Promise.all([
    allRows('clients','id,organization_id,name,deleted_at',organizationId),
    allRows('perfumes','id,organization_id,full_name_raw,normalized_name,base_name',organizationId),
    allRows('sales','id,organization_id,client_id,perfume_id,sale_date,sale_type,volume_ml,amount,payment_status,payment_method,paid_at,shipped_at,client_name_raw,original_client,perfume_name_raw,inventory_allocation_eligible,deleted_at',organizationId),
    allRows('inventory_items','id,organization_id,perfume_id,reference_date,available_ml,status',organizationId),
    allRows('inventory_allocations','id,organization_id,inventory_item_id,sale_id,perfume_id,quantity_ml,status',organizationId),
  ])
  const snapshot={organization_id:organizationId,tables:{clients,perfumes,sales,inventory_items:inventoryItems,inventory_allocations:inventoryAllocations}}
  const staging=stageDaviParsedRows(preview.rows,snapshot)
  return{...analyzeDaviImport({staging,snapshot}),file_name:file.name}as DaviDiagnosticReport
}

export const safeDaviRows=(report:DaviDiagnosticReport)=>report.rows.filter(row=>
  (row.identity_classification==='NEW_SALE'||(row.identity_classification==='EXACT_EXISTING'&&Object.keys(row.proposed_changes).length>0))
  &&['STOCK_OK','STOCK_NOT_REQUIRED'].includes(row.stock_classification??''))
