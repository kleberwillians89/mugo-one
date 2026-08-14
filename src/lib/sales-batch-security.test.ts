import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
const migration=readFileSync(new URL('../../supabase/migrations/202608130010_ai_sales_batch_import.sql',import.meta.url),'utf8')
const parser=readFileSync(new URL('../../supabase/functions/parse-sales-batch/index.ts',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const security=readFileSync(new URL('../../supabase/functions/_shared/security.ts',import.meta.url),'utf8')
describe('segurança da importação de lote com IA',()=>{
  it('preview declara zero writes e confirmação humana',()=>{expect(parser).toContain('writes:0');expect(parser).toContain('requires_human_confirmation:true');expect(parser).not.toContain(".insert(");expect(parser).not.toContain(".update(")})
  it('confirma transacionalmente com pending e sem inventar pagamento',()=>{expect(migration).toContain("'pending'");expect(migration).toContain('confirm_ai_sales_batch');expect(migration).not.toContain("'paid'")})
  it('não cria shipment, allocation, checkout ou etiqueta',()=>{for(const forbidden of ['insert into public.shipments','insert into public.inventory_allocations','/checkout','/cart'])expect(migration+parser).not.toContain(forbidden)})
  it('possui fingerprint único, idempotência, auditoria e tenant',()=>{expect(migration).toContain('unique(organization_id,fingerprint)');expect(migration).toContain("'idempotent',true");expect(migration).toContain("'ai_sales_batch_confirmed'");expect(migration).toContain('has_org_role')})
  it('frontend envia organização do contexto autenticado',()=>{expect(records).toContain('organization_id:organizationId');expect(records).toContain('authenticatedOrganization()')})
  it('mantém auth antes da resolução opcional de tenant',()=>{expect(parser).toContain('context(req,{allowSingleOrganizationFallback:true})');expect(records).toContain('Sua sessão expirou. Entre novamente.')})
  it('rejeita sessão inexistente e sessão expirada',()=>{expect(security).toContain("authorization?.startsWith('Bearer ')");expect(security).toContain('if (error || !user)');expect(security).toContain("code: 'unauthorized'")})
})
