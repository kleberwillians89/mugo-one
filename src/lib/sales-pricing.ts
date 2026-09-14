import type {AiSalesBatchPreview,AiSalesBatchSale} from './records'

type BatchPricing=Pick<AiSalesBatchPreview,'quote_per_ml'|'recrimping_fee'|'apc_extra'>

const roundMoney=(value:number)=>Math.round(value*100)/100

export function calculateBatchSaleAmount(pricing:BatchPricing,sale:Pick<AiSalesBatchSale,'sale_type'|'volume_ml'>){
  const quote=pricing.quote_per_ml
  if(quote===null||!Number.isFinite(quote)||quote<0||!Number.isFinite(sale.volume_ml))return null
  const additional=sale.sale_type==='APC'?(pricing.apc_extra??0):(pricing.recrimping_fee??0)
  return roundMoney(sale.volume_ml*quote+additional)
}

export function batchPricingIssues(pricing:BatchPricing,sales:AiSalesBatchSale[]){
  if(pricing.quote_per_ml===null)return[]
  return sales.flatMap(sale=>{
    const expected=calculateBatchSaleAmount(pricing,sale)
    if(expected===null||Math.abs(sale.amount-expected)<.01)return[]
    return[{sale_type:sale.sale_type,volume_ml:sale.volume_ml,announced_amount:sale.amount,expected_amount:expected}]
  })
}
