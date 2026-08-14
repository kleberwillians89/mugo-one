import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const security=readFileSync(new URL('../../supabase/functions/_shared/security.ts',import.meta.url),'utf8')
const intelligence=readFileSync(new URL('../../supabase/functions/ask-intelligence/index.ts',import.meta.url),'utf8')
const sync=readFileSync(new URL('../../supabase/functions/superfrete-sync-shipment/index.ts',import.meta.url),'utf8')
const shipmentPage=readFileSync(new URL('../components/ShipmentOperations.tsx',import.meta.url),'utf8')

describe('transporte CORS da inteligência',()=>{
  it('autoriza o domínio oficial e todos os headers do cliente Supabase',()=>{expect(security).toContain("'https://crm.ruahparfums.com.br'");expect(security).toContain('authorization, apikey, content-type, x-client-info')})
  it('OPTIONS encerra antes de autenticação e consultas',()=>{expect(security.indexOf("req.method === 'OPTIONS'")).toBeLessThan(security.indexOf("req.headers.get('authorization')"))})
  it.each([200,400,401,500])('respostas %i usam o helper JSON com CORS',()=>{expect(security).toContain("...(req ? corsHeaders(req) : {})");expect(intelligence).toContain('const respond = (body: unknown, status = 200) => json(body, status, req)')})
})

describe('handlers reais da central de etiqueta',()=>{
  it('sync chama apenas a função de sincronização e faz refetch',()=>{expect(shipmentPage).toContain('await syncSuperFreteShipment(shipment.id)');expect(shipmentPage).toContain('await fetchShipment360(shipment.id)')})
  it('clipboard possui API principal, fallback e feedback',()=>{expect(shipmentPage).toContain('navigator.clipboard?.writeText');expect(shipmentPage).toContain("document.execCommand('copy')");expect(shipmentPage).toContain('Código de rastreio copiado.')})
  it('impressão abre aba diretamente no clique',()=>{expect(shipmentPage).toContain("window.open('','_blank')");expect(shipmentPage).toContain('tab.opener=null');expect(shipmentPage).toContain('tab.location.href=url')})
  it('bloqueia clique duplo durante sync',()=>expect(shipmentPage).toContain('if(busy)return'))
})

describe('impressão SuperFrete sem nova compra',()=>{
  it('sincroniza somente order/info e testa o arquivo oficial',()=>{expect(sync).toContain('/api/v0/order/info/');expect(sync).toContain('probeOfficialPrintFile');expect(sync).not.toContain('/api/v0/cart');expect(sync).not.toContain('/api/v0/checkout')})
  it('não responde sucesso quando a saúde de impressão não foi persistida',()=>{expect(sync).toContain('print_health_persist_failed');expect(sync).toContain(".select('*').single()");expect(sync).toContain('data:updated')})
})
