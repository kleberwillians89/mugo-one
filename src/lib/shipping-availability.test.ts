import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
const migration=readFileSync(new URL('../../supabase/migrations/202608220002_sale_shipping_availability.sql',import.meta.url),'utf8')
const portal=readFileSync(new URL('../portal/CustomerPortalApp.tsx',import.meta.url),'utf8')
const preview=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')
describe('disponibilidade para envio',()=>{
  it('fica na venda/origem, não no perfume global',()=>{expect(migration).toContain('alter table public.sales');expect(migration).not.toContain('alter table public.perfumes')})
  it('separa toda previsão por data da confirmação operacional',()=>{expect(migration).toContain("shipping_availability_kind := 'expected_by_date'");expect(migration).toContain('shipping_availability_confirmed_at is not null');expect(migration).not.toContain('shipping_available_date<=current_date')})
  it('bloqueia solicitação no backend',()=>{expect(migration).toContain('shipping_availability_pending');expect(migration).toContain('customer_shipping_allocations_requestable')})
  it('não altera estoque físico nem post_shipment',()=>{expect(migration).not.toContain('physical_ml =');expect(migration).not.toContain('available_ml =');expect(migration).not.toContain('post_shipment')})
  it('portal comunica preparação e só oferece volume liberado',()=>{expect(portal).toContain('aguardando preparação');expect(portal).toContain('g.available_ml > 0')})
  it('preview exige confirmação humana',()=>{expect(preview).toContain('CONFIRMAR DISPONIBILIDADE');expect(preview).toContain('shipping_availability_human_confirmed')})
  it('aceita diferenças por venda para o mesmo perfume',()=>expect(migration).toContain('join public.sales s on s.id=a.sale_id'))
})
