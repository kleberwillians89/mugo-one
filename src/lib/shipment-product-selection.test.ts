import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const selector=readFileSync(new URL('../components/ShipmentProductSelector.tsx',import.meta.url),'utf8')
const client=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const operations=readFileSync(new URL('../components/ShipmentOperations.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const foundation=readFileSync(new URL('../../supabase/migrations/202608130001_operational_foundation.sql',import.meta.url),'utf8')
const rpc=foundation.slice(foundation.indexOf('create or replace function public.create_draft_shipment'),foundation.indexOf('create or replace function public.cancel_draft_shipment'))

describe('seleção manual de produtos do frete',()=>{
  it('abre pela cliente e reutiliza o seletor no modal global',()=>{expect(client).toContain('Criar frete');expect(client).toContain('<ShipmentProductSelector');expect(operations).toContain('<ShipmentProductSelector')})
  it('mostra todas as colunas e os cinco filtros solicitados',()=>{for(const label of ['Compra','Perfume','Frasco','Status histórico','Confirmação manual','Shipment atual','Data de envio','Status operacional','PENDENTES','TODOS','ENVIADOS','NÃO ENVIADOS','A CONFIRMAR'])expect(selector).toContain(label)})
  it('TODOS não elimina compras enviadas e PENDENTES começa ativo',()=>{expect(selector).toContain("useState<Filter>('eligible')");expect(selector).toContain("filter==='all'");expect(selector).toContain("legacyShippingState(row.sale.legacy_shipping_confirmation)===filter")})
  it('bloqueia item com shipment e exibe aviso explícito sem inventar reenvio',()=>{expect(selector).toContain("eligible:Boolean(allocation&&!shipment)");expect(selector).toContain('disabled={!eligible||disabled}');expect(selector).toContain('Este item já possui envio registrado.');expect(selector).toContain('reenvio ainda não é uma operação disponível')})
  it('envia somente allocations marcadas e o backend revalida o conjunto',()=>{expect(selector).toContain('createDraftShipment(clientId,selected)');expect(records).toContain('p_allocation_ids:allocationIds');expect(rpc).toContain('id=any(p_allocation_ids)');expect(rpc).toContain('v_count<>cardinality(p_allocation_ids)');expect(rpc).toContain("status='reserved'")})
  it('não altera confirmação, pagamento ou estoque ao selecionar',()=>{for(const forbidden of ['setLegacyShippingConfirmation','payment_status=','inventory_items'])expect(selector).not.toContain(forbidden)})
})
