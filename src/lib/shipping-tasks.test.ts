import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
import type{OperationalShipment,ReservedAllocation}from'./records'
import{matchesShippingTask,summarizeShippingTasks}from'./shipping-tasks'

const shipment=(status:string,overrides:Partial<OperationalShipment>={}):OperationalShipment=>({
  id:`shipment-${status}`,organization_id:'org',client_id:'client',status,created_at:'2026-09-14',recipient_name:'Cliente',recipient_phone:'11999999999',recipient_document:'123',recipient_email:'cliente@teste.com',recipient_postal_code:'01001000',recipient_address:'Rua',recipient_number:'1',recipient_complement:null,recipient_district:'Centro',recipient_city:'São Paulo',recipient_state:'SP',package_weight:1,package_height:10,package_width:10,package_length:10,package_format:'box',declared_value:100,fiscal_mode:'declaration',selected_quote_id:null,carrier:null,service:null,service_id:null,shipping_price:null,superfrete_order_id:null,superfrete_status:null,checkout_status:null,tracking_code:null,print_url:null,label_pdf_url:null,integration_error:null,print_available:false,print_http_status:null,print_content_type:null,print_checked_at:null,conference_owner_user_id:null,conference_owner_name_snapshot:null,conference_started_at:null,conference_completed_at:null,clients:{name:'Cliente'},shipment_quotes:[],shipment_items:[{allocation_id:'allocation',quantity_ml:5,separated_at:'2026-09-14',checked_at:'2026-09-14',divergence_note:null,bottle_id:null,split_unit_id:null,inventory_allocations:null,inventory_bottles:null,inventory_split_units:null,sales:{id:'sale',amount:100,payment_status:'paid',split_completed_at:'2026-09-14',perfume_name_raw:'Perfume',sale_type:'SPLIT',shipping_deadline_date:null}}],...overrides,
})

describe('filas operacionais de entrega',()=>{
  it('separa cotação, aprovação, conferência, etiqueta e postagem em filas acionáveis',()=>{
    const rows=[
      shipment('draft'),
      shipment('awaiting_customer_approval',{id:'approval',selected_quote_id:'quote'}),
      shipment('customer_approved',{id:'conference',shipment_items:[{...shipment('draft').shipment_items[0],checked_at:null}]}),
      shipment('customer_approved',{id:'label'}),
      shipment('label_released',{id:'post',print_available:true}),
    ]
    expect(rows.filter(row=>matchesShippingTask(row,'quote')).map(row=>row.id)).toEqual(['shipment-draft'])
    expect(rows.filter(row=>matchesShippingTask(row,'approval')).map(row=>row.id)).toEqual(['approval'])
    expect(rows.filter(row=>matchesShippingTask(row,'conference')).map(row=>row.id)).toEqual(['conference'])
    expect(rows.filter(row=>matchesShippingTask(row,'label')).map(row=>row.id)).toEqual(['label'])
    expect(rows.filter(row=>matchesShippingTask(row,'post')).map(row=>row.id)).toEqual(['post'])
  })
  it('não libera etiqueta com pagamento ou separação pendente',()=>{
    const unpaid=shipment('customer_approved',{shipment_items:[{...shipment('draft').shipment_items[0],sales:{...shipment('draft').shipment_items[0].sales!,payment_status:'pending'}}]})
    const pendingSplit=shipment('customer_approved',{shipment_items:[{...shipment('draft').shipment_items[0],sales:{...shipment('draft').shipment_items[0].sales!,split_completed_at:null}}]})
    expect(matchesShippingTask(unpaid,'conference')).toBe(true)
    expect(matchesShippingTask(pendingSplit,'conference')).toBe(true)
    expect(matchesShippingTask(unpaid,'label')).toBe(false)
    expect(matchesShippingTask(pendingSplit,'label')).toBe(false)
  })
  it('conta clientes pagos sem shipment uma vez, mesmo com vários perfumes',()=>{
    const allocation={client_id:'client',sale_id:'sale-1'} as ReservedAllocation
    expect(summarizeShippingTasks([], [allocation,{...allocation,sale_id:'sale-2'}]).paidWaitingClients).toBe(1)
  })
})

describe('gate definitivo de etiqueta',()=>{
  const sql=readFileSync('supabase/migrations/202609140002_operational_task_and_label_gate.sql','utf8')
  const edge=readFileSync('supabase/functions/superfrete-create-label/index.ts','utf8')
  it('valida pagamento, split/APC, conferência e origem física no backend',()=>{for(const rule of['payment_incomplete','split_incomplete','conference_incomplete','physical_source_not_confirmed'])expect(sql).toContain(rule)})
  it('usa shipping.label em vez do cargo legado admin/manager',()=>{expect(edge).toContain("permission_code:'shipping.label'");expect(edge).not.toContain("['admin','manager']")})
  it('protege tanto a criação do carrinho quanto o checkout',()=>{expect(sql.match(/perform public\.assert_shipment_label_ready\(v\.id\)/g)?.length).toBeGreaterThanOrEqual(3)})
})
