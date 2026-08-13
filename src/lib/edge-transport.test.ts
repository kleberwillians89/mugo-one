import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const security=readFileSync(new URL('../../supabase/functions/_shared/security.ts',import.meta.url),'utf8')
const intelligence=readFileSync(new URL('../../supabase/functions/ask-intelligence/index.ts',import.meta.url),'utf8')
const sync=readFileSync(new URL('../../supabase/functions/superfrete-sync-shipment/index.ts',import.meta.url),'utf8')

describe('transporte CORS da inteligência',()=>{
  it('autoriza o domínio oficial e todos os headers do cliente Supabase',()=>{expect(security).toContain("'https://crm.ruahparfums.com.br'");expect(security).toContain('authorization, apikey, content-type, x-client-info')})
  it('OPTIONS encerra antes de autenticação e consultas',()=>{expect(security.indexOf("req.method === 'OPTIONS'")).toBeLessThan(security.indexOf("req.headers.get('authorization')"))})
  it.each([200,400,401,500])('respostas %i usam o helper JSON com CORS',()=>{expect(security).toContain("...(req ? corsHeaders(req) : {})");expect(intelligence).toContain('const respond = (body: unknown, status = 200) => json(body, status, req)')})
})

describe('impressão SuperFrete sem nova compra',()=>{
  it('sincroniza somente order/info e testa PDF oficial',()=>{expect(sync).toContain('/api/v0/order/info/');expect(sync).toContain("hostname==='etiqueta.superfrete.com'");expect(sync).toContain("includes('application/pdf')");expect(sync).not.toContain('/api/v0/cart');expect(sync).not.toContain('/api/v0/checkout')})
})
