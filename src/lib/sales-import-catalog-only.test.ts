import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const sql=readFileSync('supabase/migrations/202608230006_sales_import_catalog_only.sql','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const ui=readFileSync('src/components/AiSalesBatchImport.tsx','utf8')
const davi=readFileSync('supabase/migrations/202608220007_davi_excel_sale_input.sql','utf8')
const legacy=readFileSync('supabase/migrations/202608140004_perfume_resolution_hotfix.sql','utf8')

describe('novas vendas resolvem catálogo sem fabricar estoque',()=>{
  const resolver=sql.slice(sql.indexOf('create or replace function public.resolve_ai_catalog_perfume'),sql.indexOf('create or replace function public.bootstrap_ai_batch_inventory('))
  const compatibility=sql.slice(sql.indexOf('create or replace function public.bootstrap_ai_batch_inventory('),sql.indexOf('-- Confirmação single'))
  const confirmations=sql.slice(sql.indexOf('-- Confirmação single'))
  it('resolver comercial escreve somente perfumes',()=>{expect(resolver).toContain('insert into public.perfumes');for(const forbidden of ['insert into public.inventory_items','insert into public.inventory_movements','inventory_apply','ensure_perfume_operational_code'])expect(resolver).not.toContain(forbidden)})
  it('wrappers bootstrap preservam assinatura, mas não calculam nem gravam ml',()=>{expect(compatibility).toContain('bootstrap_ai_batch_inventory_resolved');expect(compatibility).toContain('resolve_ai_catalog_perfume');for(const forbidden of ['bootstrap_ml','physical_ml','available_ml','inventory_movements','inventory_items('])expect(compatibility).not.toContain(forbidden)})
  it('confirmações single e multi criam sales com inventory_item opcional',()=>{expect(confirmations).toContain('insert into public.sales');expect(confirmations).toContain("nullif(p_batch->>'inventory_item_id','')");expect(confirmations).toContain("nullif(group_item->>'inventory_item_id','')");for(const forbidden of ['insert into public.inventory_items','insert into public.inventory_movements','inventory_apply(','bootstrap_from_sales','ensure_perfume_operational_code'])expect(confirmations).not.toContain(forbidden)})
  it('frontend bloqueia por perfume_id, não por existência de estoque',()=>{expect(ui).toContain('if(!group.perfume_id)');expect(ui).toContain("else if(!preview.perfume_id)");expect(records).toContain("if(!preview.perfume_id)throw new Error('Resolva o perfume de catálogo.')")})
  it('Davi cria somente sale vinculada ao perfume',()=>{expect(davi).toContain('insert into public.sales');for(const forbidden of ['inventory_items','inventory_movements','inventory_apply','operational_code'])expect(davi).not.toContain(forbidden)})
  it('histórico bootstrap antigo permanece intocado e auditável',()=>{expect(legacy).toContain('bootstrap_from_sales');expect(sql).not.toMatch(/delete\s+from\s+public\.(?:inventory_items|inventory_movements|ai_inventory_bootstraps)/i);expect(sql).not.toMatch(/update\s+public\.(?:inventory_items|inventory_movements)/i)})
})
