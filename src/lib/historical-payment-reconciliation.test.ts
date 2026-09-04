import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync(new URL('../../supabase/migrations/202609030001_historical_payment_reconciliation.sql',import.meta.url),'utf8')
const stripComments=(sql:string)=>sql.split('\n').map(line=>line.slice(0,line.indexOf('--')<0?line.length:line.indexOf('--'))).join('\n')
const code=stripComments(migration)
const apply=migration.slice(migration.indexOf('create function public.reconcile_approved_historical_payments'),migration.indexOf('create function public.rollback_approved_historical_payments'))
const rollback=migration.slice(migration.indexOf('create function public.rollback_approved_historical_payments'),migration.lastIndexOf('commit;'))
const approvedIds=['f676eb8b-7233-412d-80a9-6db94925384c','98e9eb88-a071-46a8-a0b5-e10f904c9bfb']

describe('reconciliação histórica — escopo fechado e autenticação',()=>{
  it('aceita exclusivamente as duas vendas e o lote/hash aprovados',()=>{
    for(const id of approvedIds)expect(apply).toContain(id)
    expect((apply.match(/"sale_id"/g)??[])).toHaveLength(2)
    expect(apply).toContain("approved_batch constant uuid := '858edc62-067f-4124-8d95-206230d1268f'")
    expect(apply).toContain("approved_hash constant text := '4fee55f810d6d66f13e5443cf79240fe0407202ddd54e15c48b619057a86ea66'")
    expect(apply).toContain("raise exception 'historical_reconciliation_payload_mismatch'")
  })
  it('é admin-only, tenant-safe e não aceita ator vindo do payload',()=>{
    expect(apply).toContain('auth.uid() is null')
    expect(apply).toContain("has_org_role(p_organization_id,array['admin']::public.member_role[])")
    expect(apply).toContain("raise exception 'historical_reconciliation_tenant_not_approved'")
    expect(apply).toContain("raise exception 'historical_reconciliation_wrong_tenant:%'")
    expect(apply).not.toMatch(/p_actor_id|p_user_id/)
  })
})

describe('reconciliação histórica — transição válida sem estoque',()=>{
  it('faz pending → paid e elegibilidade → false atomicamente no mesmo UPDATE',()=>{
    const update=apply.slice(apply.indexOf('update public.sales set'),apply.indexOf('returning * into after_row'))
    expect(update).toContain('inventory_allocation_eligible=false')
    expect(update).toContain("payment_status='paid'")
    expect(update).toContain("payment_method=item->>'payment_method'")
    expect(update).toContain("paid_at=(item->>'paid_at')::date")
  })
  it('não modifica trigger/função canônica nem escreve em estoque, alocações, movimentos, preparação ou envio',()=>{
    expect(code).not.toMatch(/create or replace function public\.sync_sale_inventory_allocation|drop trigger|alter trigger|disable trigger/i)
    expect(code).not.toMatch(/(?:insert into|update|delete from) public\.(inventory_items|inventory_allocations|inventory_movements|inventory_purchase_entries|preparation_batches|preparation_batch_items|shipments|shipment_items)/i)
    expect(new Set(code.match(/update public\.\w+/g)??[])).toEqual(new Set(['update public.sales']))
  })
  it('recusa venda ativa, alocação, preparação/envio ativo, stale row e tenant incorreto',()=>{
    for(const guard of ['sale_not_pending','incompatible_eligibility','stale_sale','evidence_not_approved','active_allocation','active_preparation','active_shipment','wrong_tenant'])
      expect(apply).toContain(`historical_reconciliation_${guard}`)
    expect(apply).toContain("a.status in('reserved','shipping','shipped')")
    expect(apply).toContain("pb.status<>'cancelled'")
    expect(apply).toContain("sh.status not in('posted','delivered','cancelled')")
  })
})

describe('reconciliação histórica — locking, idempotência, auditoria e rollback',()=>{
  it('serializa o lote e trava todas as vendas com FOR UPDATE antes da primeira escrita',()=>{
    expect(apply).toContain('pg_advisory_xact_lock')
    const firstLoop=apply.indexOf('for item in select value')
    const validation=apply.slice(apply.indexOf('-- Trava e valida'),apply.indexOf('for item in select value',firstLoop+1))
    expect(validation).toContain('for update')
    expect(apply.indexOf('for update')).toBeLessThan(apply.indexOf('update public.sales set'))
  })
  it('segunda execução retorna idempotente sem novo UPDATE ou audit por venda',()=>{
    expect(apply).toContain("action='historical_payment_reconciliation_completed'")
    expect(apply).toContain("'idempotent',true,'updated_sales',0")
    expect(apply.indexOf("'idempotent',true,'updated_sales',0")).toBeLessThan(apply.indexOf('update public.sales set'))
  })
  it('audita batch, sale_id, before/after, timestamp implícito, origem, reason e hash',()=>{
    expect(apply).toContain("'historical_payment_reconciled','sale',after_row.id::text")
    for(const field of ["'batch_id'","'operation_hash'","'origin'","'reason'","'before'","'after'"])expect(apply).toContain(field)
    expect(apply).toContain("'historical_payment_reconciliation_completed','historical_payment_batch'")
  })
  it('erro em qualquer linha desfaz a transação inteira: não há bloco EXCEPTION e o lote só conclui no fim',()=>{
    expect(apply).not.toMatch(/\bexception\s+when\b/i)
    expect(apply.lastIndexOf("'historical_payment_reconciliation_completed'")).toBeGreaterThan(apply.lastIndexOf('update public.sales set'))
    expect(migration.startsWith('begin;')).toBe(true)
    expect(migration.trim().endsWith('commit;')).toBe(true)
  })
  it('rollback é fechado ao mesmo lote, exige estado inalterado e restaura o before auditado',()=>{
    expect(rollback).toContain("action='historical_payment_reconciliation_completed'")
    expect(rollback).toContain("raise exception 'historical_rollback_sale_changed:%'")
    expect(rollback).toContain("inventory_allocation_eligible=(reconciliation.metadata#>>'{before,inventory_allocation_eligible}')::boolean")
    expect(rollback).toContain("payment_status=(reconciliation.metadata#>>'{before,payment_status}')::public.payment_status")
    expect(rollback).toContain("'historical_payment_reconciliation_rolled_back'")
  })
})
