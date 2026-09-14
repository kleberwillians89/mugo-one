import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const ai=readFileSync('src/components/AiSalesBatchImport.tsx','utf8')
const davi=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const summary=readFileSync('src/lib/ai-import-preview-summary.ts','utf8')
const migration=readFileSync('supabase/migrations/202609140003_required_sale_bottle_identity.sql','utf8')
const unlimited=readFileSync('supabase/migrations/202609140004_unbounded_sale_bottle_number.sql','utf8')

describe('identidade obrigatória do frasco do Davi',()=>{
  it('obriga um número de frasco inteiro positivo sem limitar a sequência',()=>{expect(ai).toContain('NÚMERO DO FRASCO *');expect(ai).toContain('Number.isInteger(value)&&value>0');expect(ai).toContain('Frasco 1, 2, 3, 20 ou qualquer número positivo')})
  it('aceita Frasco 20 na grade Davi Excel',()=>{expect(davi).toContain("!/^[1-9]\\d*$/.test(row.bottleNumber.trim())");expect(davi).toContain('placeholder="Ex.: 20"')})
  it('mostra no estoque os frascos que originaram o saldo',()=>{expect(inventory).toContain('fetchInventorySaleBottleIdentities');expect(inventory).toContain('FRASCOS DESTA VENDA')})
  it('inclui o frasco no nome exibido em cada pedido revisado',()=>expect(summary).toContain('perfumeWithBottle(salePerfume,saleBottle)'))
  it('separa a fila do Gabriel por perfume, tipo e frasco e inclui qualquer frasco positivo no nome operacional',()=>{expect(migration).toContain('group by sale_type,perfume_id,bottle_identifier');expect(unlimited).toContain("perfume_name_raw:=");expect(unlimited).toContain("'^FRASCO [1-9][0-9]*$'")})
})
