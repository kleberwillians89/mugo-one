import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const sql=readFileSync('supabase/migrations/202608230005_preparation_sale_type.sql','utf8')
const page=readFileSync('src/pages/PreparationPage.tsx','utf8')
const station=readFileSync('src/pages/InventoryStationPage.tsx','utf8')

describe('preparação canônica por tipo de venda',()=>{
 it('expõe sale_type sem criar estado paralelo',()=>{expect(sql).toContain('s.sale_type');expect(sql).toContain('inventory_allocations');expect(sql).toContain('preparation_batch_items');expect(sql).not.toMatch(/create table/i)})
 it('separa SPLIT e APC e nunca soma APC no total SPLIT',()=>{expect(page).toContain("splitItems=items.filter(item=>item.sale_type==='SPLIT')");expect(page).toContain("apcItems=items.filter(item=>item.sale_type==='APC')");expect(page).toContain("selected.filter(item=>item.sale_type==='SPLIT').reduce");expect(page).toContain('TOTAL SPLIT:')})
 it('preserva seleção parcial e reutiliza preparation_batches',()=>{expect(page).toContain('item.selected');expect(page).toContain('createPreparationBatch');expect(page).toContain('confirmPreparationBatch')})
 it('scan RUAH-P encaminha o perfume identificado para preparação',()=>{expect(station).toContain('/estoque/fracionamento?perfume=');expect(station).toContain('PREPARAR ESTE PERFUME');expect(page).toContain("new URLSearchParams(location.search).get('perfume')")})
})
