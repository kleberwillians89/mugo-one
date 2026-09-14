import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const ai=readFileSync('src/components/AiSalesBatchImport.tsx','utf8')
const davi=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const summary=readFileSync('src/lib/ai-import-preview-summary.ts','utf8')
const migration=readFileSync('supabase/migrations/202609140003_required_sale_bottle_identity.sql','utf8')

describe('identidade obrigatória do frasco do Davi',()=>{
  it('obriga a escolha entre Frasco 1, 2 e 3 na importação inteligente',()=>{expect(ai).toContain('FRASCO DO LOTE *');expect(ai).toContain('validBottleNumber(preview.bottle_number)');expect(ai).toContain('<option value="3">FRASCO 3</option>')})
  it('usa a mesma escolha limitada na grade Davi Excel',()=>{expect(davi).toContain("!/^[1-3]$/.test(row.bottleNumber.trim())");expect(davi).toContain('<option value="2">FRASCO 2</option>')})
  it('mostra no estoque os frascos que originaram o saldo',()=>{expect(inventory).toContain('fetchInventorySaleBottleIdentities');expect(inventory).toContain('FRASCOS DESTA VENDA')})
  it('inclui o frasco no nome exibido em cada pedido revisado',()=>expect(summary).toContain('perfumeWithBottle(salePerfume,saleBottle)'))
  it('separa a fila do Gabriel por perfume, tipo e frasco e inclui o frasco no nome operacional',()=>{expect(migration).toContain('group by sale_type,perfume_id,bottle_identifier');expect(migration).toContain("perfume_name_raw:=");expect(migration).toContain("'^FRASCO [1-3]$'")})
})
