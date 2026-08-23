import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type PerfumeReceiptSale = { sale_id:string;client_name:string;quantity_ml:number;sale_date:string }
export type PerfumeReceiptPreview = {
  perfume_id:string;perfume_name:string;brand_house:string|null;operational_code:string;sales:PerfumeReceiptSale[]
}
export type PerfumeReceiptResult = {
  ok:boolean;already_confirmed:boolean;sale_count:number;confirmed_count:number;total_ml:number;perfume_id:string;operational_code:string
}

export async function previewPerfumeReceipt(code:string){
  await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('perfume_receipt_preview',{p_operational_code:code})
  if(error)throw new Error(error.message)
  return data as PerfumeReceiptPreview|null
}

export async function confirmPerfumeReceipt(code:string,saleIds:string[]){
  await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('perfume_receipt_confirm',{p_operational_code:code,p_sale_ids:saleIds})
  if(error)throw new Error(error.message)
  return data as PerfumeReceiptResult
}
