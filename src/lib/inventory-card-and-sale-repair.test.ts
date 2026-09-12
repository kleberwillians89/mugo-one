import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const inventoryCss=readFileSync('src/pages/InventoryPage.css','utf8')
const assistant=readFileSync('src/components/AiSalesBatchImport.tsx','utf8')
const repair=readFileSync('supabase/migrations/202609120004_repair_missing_sale_inventory.sql','utf8')
const reimport=readFileSync('supabase/migrations/202609120005_reimport_deleted_ai_sales_batch.sql','utf8')
const parser=readFileSync('supabase/functions/parse-sales-batch/index.ts','utf8')

describe('estoque visual e reparo do perfume da venda',()=>{
  it('troca a tabela por cards pesquisáveis com saldos operacionais',()=>{expect(inventory).toContain('inventory-card-grid');expect(inventory).toContain('Buscar perfume no estoque');for(const label of['DISPONÍVEL PARA VENDA','Físico','Reservado','Em preparo','Em envio','Custo/ML'])expect(inventory).toContain(label);expect(inventoryCss).toContain('grid-template-columns:repeat(3')})
  it('oculta os controles de bipagem da tela principal',()=>{for(const hidden of['Estação de estoque','Abrir no leitor','BottleOnboardingModal'])expect(inventory).not.toContain(hidden)})
  it('orienta o Davi a cadastrar, vincular e concluir as vendas',()=>{for(const text of['CADASTRAR PERFUME E VINCULAR','CADASTRAR E VINCULAR','aparecerá no Estoque ao confirmar as vendas','sobra correta de ML'])expect(assistant).toContain(text)})
  it('repara sem duplicar vendas e cobre saldo zero desde 04/09',()=>{expect(repair).toContain("date '2026-09-04'");expect(repair).toContain('on conflict(organization_id,perfume_id) do nothing');expect(repair).toContain('greatest(0');expect(repair).toContain("'missing_sale_inventory_repaired'");expect(repair).not.toMatch(/insert into public\.sales/i)})
  it('permite nova importação somente quando o lote anterior não tem vendas ativas',()=>{expect(parser).toContain('sha256(`${saleDate}|');expect(parser).toContain('enrichedSales.some(sale=>sale.possible_duplicate)');expect(reimport).toContain("s.deleted_at is null");expect(reimport).toContain("fingerprint='archived-'");expect(reimport).toContain("'deleted_ai_sales_batch_archived_for_reimport'");expect(reimport).not.toMatch(/delete from public\.(?:sales|ai_sales_batches)/i)})
})
