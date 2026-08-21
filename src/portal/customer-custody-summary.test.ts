import { describe, expect, it } from 'vitest'
import type { CustodyItem, ShipmentRequest } from '../lib/customer-portal'
import { requestForAllocation, summarizeCustomerCustody } from './customer-custody-summary'

const custody=(status:'reserved'|'shipping',requested=true):CustodyItem=>({allocation_id:'allocation-a',perfume_id:'balenciaga',perfume_name:'BALENCIAGA',quantity_ml:10,sale_date:'2026-08-21',allocation_status:status,requested,request_id:requested?'request-a':null})
const request=(status:string):ShipmentRequest=>({request_id:'request-a',status:'converted',requested_at:'2026-08-21T19:00:00Z',cancelled_at:null,items:[{allocation_id:'allocation-a',perfume:'BALENCIAGA',quantity_ml:10}],converted_shipment_id:'shipment-a',shipment_status:status,awaiting_approval:status==='awaiting_customer_approval',shipping_price:9.36,carrier:'Loggi',service:'Expresso',selected_quote_id:'quote-a',customer_approved_at:null,tracking_code:null,posted_at:null,delivered_at:null})

describe('Minha RUAH physical custody semantics',()=>{
  it('keeps 10 ml in custody while awaiting customer approval',()=>{const item=custody('shipping'),shipment=request('awaiting_customer_approval'),summary=summarizeCustomerCustody([item],[shipment]);expect(summary).toEqual({physicalMl:10,availableMl:0,awaitingApprovalMl:10,preparingMl:0,inTransitMl:0});expect(requestForAllocation([shipment],item.allocation_id)).toBe(shipment)})
  it('moves approved quantity to preparation without removing physical custody',()=>expect(summarizeCustomerCustody([custody('shipping')],[request('customer_approved')])).toEqual({physicalMl:10,availableMl:0,awaitingApprovalMl:0,preparingMl:10,inTransitMl:0}))
  it('removes posted quantity from physical custody and reports it in transit',()=>expect(summarizeCustomerCustody([],[request('posted')])).toEqual({physicalMl:0,availableMl:0,awaitingApprovalMl:0,preparingMl:0,inTransitMl:10}))
  it('restores all 10 ml as available after the request and shipment are cancelled',()=>{const cancelled={...request('cancelled'),status:'cancelled' as const};expect(summarizeCustomerCustody([custody('reserved',false)],[cancelled])).toEqual({physicalMl:10,availableMl:10,awaitingApprovalMl:0,preparingMl:0,inTransitMl:0})})
})
