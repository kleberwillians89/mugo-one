import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {summarizeCustomerCustody} from '../portal/customer-custody-summary'
import type {CustodyItem,ShipmentRequest} from './customer-portal'

const migration=readFileSync('supabase/migrations/202608230003_customer_account_login_activation.sql','utf8')
const teamApproval=readFileSync('supabase/migrations/202609110001_team_shipping_approval.sql','utf8')
const legacyVisibility=readFileSync('supabase/migrations/202608230007_customer_shipment_legacy_visibility.sql','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const root=readFileSync('src/portal/CustomerPortalRoot.tsx','utf8')

const custody:CustodyItem={allocation_id:'allocation-ambre',perfume_id:'perfume-ambre',perfume_name:'Ambre Crush',quantity_ml:100,sale_date:'2026-08-23',allocation_status:'shipping',requested:true,request_id:null,shipping_requestable:false,requestable_quantity_ml:0,prepared_quantity_ml:0}
const shipment:ShipmentRequest={request_id:'shipment:12d3f0a6-3696-4fcf-bfd3-107848346a76',customer_request_id:null,source:'shipment',status:'converted',requested_at:'2026-08-23T04:00:09Z',cancelled_at:null,items:[{allocation_id:'allocation-ambre',perfume_id:'perfume-ambre',perfume:'Ambre Crush',quantity_ml:100}],converted_shipment_id:'12d3f0a6-3696-4fcf-bfd3-107848346a76',shipment_status:'awaiting_customer_approval',awaiting_approval:true,shipping_price:9.36,carrier:'loggi',service:'LOGGI',selected_quote_id:'quote-loggi',customer_approved_at:null,tracking_code:null,posted_at:null,delivered_at:null}

describe('regressão do shipment real no Minha RUAH',()=>{
  it('contabiliza o snapshot congelado como 100 ml aguardando aprovação',()=>{
    expect(summarizeCustomerCustody([custody],[shipment])).toEqual({physicalMl:100,availableMl:0,awaitingApprovalMl:100,preparingMl:0,inTransitMl:0})
  })
  it('não mostra zero quando o shipment canônico existe e a RPC de custódia volta vazia',()=>{
    expect(summarizeCustomerCustody([],[shipment])).toEqual({physicalMl:100,availableMl:0,awaitingApprovalMl:100,preparingMl:0,inTransitMl:0})
  })
  it('lista shipment diretamente por client ownership, não por custódia ou request auxiliar',()=>{
    const list=legacyVisibility
    expect(list).toContain('from public.shipments sh')
    expect(list).toContain('sh.client_id = public.current_customer_client()')
    expect(list).toContain('from public.shipment_items si')
    expect(list).toContain('left join public.inventory_allocations')
    expect(list).toContain('left join public.sales')
    expect(list).not.toMatch(/^\s+join public\.inventory_allocations a on/m)
    expect(list).not.toContain('customer_shipment_requests r')
  })
  it('exibe item, frete e valor sem exigir ação da cliente',()=>{
    expect(portal).toContain('ENVIO EM ANDAMENTO')
    expect(portal).toContain('EM APROVAÇÃO PELA RUAH')
    expect(portal).toContain('r.shipping_price != null ? brl(r.shipping_price)')
    expect(portal).toContain('Nenhuma ação é necessária')
    expect(portal).not.toContain('confirmCustomerShipment')
  })
  it('ativa somente a conta ligada ao auth.uid e nunca recebe client_id do navegador',()=>{
    expect(migration).toContain('where auth_user_id=auth.uid()')
    expect(migration).not.toMatch(/\(p_client_id|p_client_id uuid/)
    expect(migration).toContain("if v_account.status='active' then return true")
    expect(migration).toContain("if v_account.status='disabled' then raise exception")
    expect(migration).toContain("factor->>'method'='password'")
    expect(root).toContain('if(await activateCurrentCustomerAccount())')
  })
  it('aprovação do time é isolada, idempotente e conserva a cotação',()=>{
    expect(teamApproval).toContain("public.has_org_permission(v_shipment.organization_id,'shipping.label')")
    expect(teamApproval).toContain("if v_shipment.status='customer_approved' then return v_shipment")
    for(const field of ['selected_quote_id','shipping_price','carrier','service','service_id'])expect(teamApproval).toContain(field)
    expect(teamApproval).not.toMatch(/physical_ml|post_shipment|insert into public\.shipments/)
    expect(teamApproval).toContain('revoke execute on function public.customer_shipment_confirm(uuid) from authenticated')
  })
})
