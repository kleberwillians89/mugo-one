import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202609040004_davi_sale_soft_delete.sql','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const drafts=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const css=readFileSync('src/pages/DaviExcelPage.css','utf8')

describe('Davi Excel soft delete',()=>{
 it('usa RPC autenticada, tenant, lock, concorrência e soft delete',()=>{
  for(const value of['soft_delete_davi_sale','auth.uid()','current_user_org_ids','has_org_permission','for update','expected_updated_at','deleted_at=now()','davi_sale_soft_deleted'])expect(migration).toContain(value)
  expect(migration).not.toMatch(/delete\s+from\s+public\.sales/i)
  expect(records).toContain("supabase!.rpc('soft_delete_davi_sale'")
 })
 it('protege shipment, preparação e alocação manual e deixa a liberação no trigger canônico',()=>{
  for(const value of['shipment_items','preparation_batch_items','sale_has_operational_dependency','sale_has_active_shipment_allocation','sale_has_manual_verified_allocation'])expect(migration).toContain(value)
  expect(migration).not.toMatch(/update public\.inventory_items|update public\.inventory_allocations|insert into public\.inventory_movements/i)
    expect(migration).toContain('update public.sales')
 })
 it('oferece exclusão contextual, confirmação, motivo e ação local de draft',()=>{
  for(const value of['Ações da venda','Ver cliente','Excluir venda','Excluir venda?','Motivo da exclusão','Lançamento duplicado','Cliente desistiu / pedido não deve existir','Erro de importação','EXCLUIR VENDA'])expect(page).toContain(value)
  expect(drafts).toContain('title="Excluir linha"')
  expect(page).toContain('onDeleted={load}')
 })
 it('mantém ações e tabela operacionais com sticky e menu destrutivo discreto',()=>{
  for(const value of['davi-row-actions','davi-action-menu','davi-danger-action','position:sticky','davi-delete-modal'])expect(css).toContain(value)
 })
})
