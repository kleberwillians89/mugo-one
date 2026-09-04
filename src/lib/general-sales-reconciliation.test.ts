import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
import{deliveryLabel,deliveryState}from'./delivery'
import type{CommercialSale}from'./records'

const migration=readFileSync(new URL('../../supabase/migrations/202609040001_general_sales_reconciliation.sql',import.meta.url),'utf8')
const script=readFileSync(new URL('../../scripts/reconcile-general-sales.mjs',import.meta.url),'utf8')
const stripComments=(sql:string)=>sql.split('\n').map(line=>line.replace(/--.*$/,'')).join('\n')
const code=stripComments(migration)
const apply=migration.slice(migration.indexOf('create function public.apply_general_sales_reconciliation'),migration.indexOf('create function public.rollback_general_sales_reconciliation'))
const rollback=migration.slice(migration.indexOf('create function public.rollback_general_sales_reconciliation'),migration.indexOf('-- O read model'))
const sale=(patch:Partial<CommercialSale>)=>({payment_status:'unknown',shipping_operational_status:null,shipped_at:null,shipping_deadline_date:null,...patch}as CommercialSale)

describe('reconciliação geral — lote seguro',()=>{
  it('é service-role, tenant-scoped, admin-attributed e trava lote/vendas',()=>{
    expect(apply).toContain("auth.role()<>'service_role'")
    expect(apply).toContain('organization_id=p_organization_id')
    expect(apply).toContain("role='admin'")
    expect(apply).toContain('pg_advisory_xact_lock')
    expect(apply.indexOf('for update')).toBeLessThan(apply.indexOf('update public.sales set'))
  })
  it('aceita apenas match exato pending → paid com evidência financeira completa',()=>{
    for(const guard of ["match_method'<>'exact_commercial_multiset'","source_payment_status'<>'paid'","target_payment_status'<>'paid'","general_reconciliation_sale_not_pending","general_reconciliation_stale_sale","general_reconciliation_state_mismatch"])
      expect(apply).toContain(guard)
    expect(apply).toContain("coalesce(btrim(item->>'target_payment_method'),'')=''\n")
    expect(apply).toContain("nullif(item->>'target_paid_at','')::date is null")
  })
  it('desliga elegibilidade antes de paid no mesmo UPDATE e não toca estoque ou shipment',()=>{
    const update=apply.slice(apply.indexOf('update public.sales set'),apply.indexOf('returning * into after_row'))
    expect(update.indexOf('inventory_allocation_eligible=false')).toBeLessThan(update.indexOf("payment_status='paid'"))
    expect(update).toContain("shipping_operational_status='ENVIADO'")
    expect(code).not.toMatch(/(?:insert into|update|delete from) public\.(inventory_items|inventory_allocations|inventory_movements|inventory_purchase_entries|preparation_batches|preparation_batch_items|shipments|shipment_items)/i)
    expect(code).not.toMatch(/drop trigger|disable trigger|sync_sale_inventory_allocation\(\)/i)
  })
  it('recusa alocação, preparação ou envio ativos antes da escrita',()=>{
    for(const guard of ['general_reconciliation_active_allocation','general_reconciliation_active_preparation','general_reconciliation_active_shipment'])expect(apply).toContain(guard)
  })
  it('é idempotente, audita before/after e conclui o batch apenas no final',()=>{
    expect(apply).toContain("action='general_sales_reconciliation_completed'")
    expect(apply).toContain("'idempotent',true,'updated_sales',0")
    for(const field of ["'source_hash'","'operation_hash'","'source_row'","'before'","'after'","'inventory_mutations',0"])expect(apply).toContain(field)
    expect(apply.lastIndexOf("'general_sales_reconciliation_completed'")).toBeGreaterThan(apply.lastIndexOf('update public.sales set'))
  })
  it('rollback exige estado posterior intacto e restaura todos os campos auditados',()=>{
    expect(rollback).toContain('general_rollback_sale_changed')
    for(const field of ['inventory_allocation_eligible=','payment_status=','payment_method=','paid_at=','shipping_operational_status='])expect(rollback).toContain(field)
    expect(rollback).toContain("'general_sales_reconciliation_rolled_back'")
  })
})

describe('reconciliação geral — dry-run e regra logística',()=>{
  it('o dry-run exclui ambíguos, limita campos e expõe as contagens pedidas',()=>{
    expect(script).toContain("allowedChanges=new Set(['payment_status','payment_method','paid_at'])")
    expect(script).toContain("classification==='existing_changed'")
    expect(script).toContain('ambiguous_rows_excluded:true')
    expect(script).toContain('no_destructive_operations:true')
    for(const field of ['sales_analyzed','not_found_in_spreadsheet','change_to_paid','change_to_pending','pending_value_after','value_marked_settled','clients_remaining'])expect(script).toContain(field)
  })
  it('paid sem data real aparece enviado sem inventar data',()=>{
    const row=sale({payment_status:'paid'})
    expect(deliveryState(row)).toBe('shipped')
    expect(deliveryLabel(row)).toBe('Enviado')
    expect(row.shipped_at).toBeNull()
  })
  it('pending aparece faltando enviar mesmo se houver histórico real, que permanece preservado',()=>{
    const row=sale({payment_status:'pending',shipped_at:'2026-08-20'})
    expect(deliveryState(row)).toBe('awaiting_shipment')
    expect(deliveryLabel(row)).toBe('Faltando enviar')
    expect(row.shipped_at).toBe('2026-08-20')
  })
  it('cancelamento e estado especial cancelado têm precedência',()=>{
    expect(deliveryLabel(sale({payment_status:'cancelled'}))).toBe('Cancelado')
    expect(deliveryLabel(sale({payment_status:'paid',shipping_operational_status:'CANCELADO'}))).toBe('Cancelado')
    const dataset=migration.slice(migration.indexOf('create or replace function public.davi_excel_dataset'))
    expect(dataset.indexOf("payment_status='cancelled'")).toBeLessThan(dataset.indexOf("payment_status='paid'"))
    expect(dataset.indexOf("payment_status='paid'")).toBeLessThan(dataset.indexOf("payment_status='pending'"))
  })
  it('não redefine a função canônica de Cobranças nem toca o MVP ManyChat',()=>{
    expect(code).not.toContain('collections_pending_sales_canonical')
    expect(code).not.toContain('whatsapp_customer_balance_v1')
    expect(code).not.toContain('manychat')
  })
})
