import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync(new URL('../../supabase/migrations/202609150001_inventory_commercial_insights.sql',import.meta.url),'utf8')
const page=readFileSync(new URL('../pages/InventoryPage.tsx',import.meta.url),'utf8')
const image=readFileSync(new URL('../components/InventoryOfferImageCard.tsx',import.meta.url),'utf8')

describe('Estoque — leitura comercial e imagem de frasco aberto',()=>{
  it('resume vendas, compradores distintos, ML, vendido e arrecadado no período',()=>{
    expect(migration).toContain('count(distinct s.client_id)')
    expect(migration).toContain("sum(s.amount) filter(where s.payment_status='paid')")
    for(const label of ['Total vendido','Arrecadado','Compradores','Valor por ML'])expect(page).toContain(label)
  })
  it('guarda preço anunciado separado do custo e permite correção auditada',()=>{
    expect(migration).toContain('sale_price_per_ml')
    expect(migration).toContain("'inventory_sale_price_updated'")
    expect(page).toContain('updateInventorySalePrice')
    expect(page).toContain('Valor/ML')
  })
  it('extrai a cotação das listas e sincroniza quando o estoque nasce da venda',()=>{
    expect(migration).toContain('extract_commercial_quote_per_ml')
    expect(migration).toContain('create trigger sale_inventory_quote_per_ml')
  })
  it('gera PNG somente para perfume com ML disponível',()=>{
    expect(page).toContain('downloadNodeAsPng')
    expect(page).toContain('disabled={Number(balance.available_ml)<=0}')
    expect(image).toContain('FRASCO EM ABERTO')
    expect(image).toContain('DISPONÍVEL PARA VENDA')
    expect(image).toContain('VALOR POR ML')
  })
})
