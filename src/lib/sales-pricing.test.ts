import {describe,expect,it} from 'vitest'
import {batchPricingIssues,calculateBatchSaleAmount} from './sales-pricing'

const pricing={quote_per_ml:41.9,recrimping_fee:9,apc_extra:50}

describe('cálculo comercial da lista do Davi',()=>{
  it('calcula um volume livre de 6 ml mesmo sem existir na tabela do anúncio',()=>expect(calculateBatchSaleAmount(pricing,{sale_type:'SPLIT',volume_ml:6})).toBe(260.4))
  it('soma o adicional do APC ao valor dos ml',()=>expect(calculateBatchSaleAmount(pricing,{sale_type:'APC',volume_ml:25})).toBe(1097.5))
  it('identifica valor manual diferente da fórmula',()=>expect(batchPricingIssues(pricing,[{client_name:'Cliente',sale_type:'SPLIT',volume_ml:6,amount:9,client_match_status:'new',client_id:null,client:null,suggestions:[],missing_shipping_fields:[],possible_duplicate:false}])).toEqual([{sale_type:'SPLIT',volume_ml:6,announced_amount:9,expected_amount:260.4}]))
})
