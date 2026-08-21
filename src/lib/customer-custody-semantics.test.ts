import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608210003_customer_custody_semantics.sql','utf8')
const staff=readFileSync('supabase/migrations/202608200002_customer_portal_staff.sql','utf8')
const launch=readFileSync('supabase/migrations/202608200006_customer_portal_launch_aal1.sql','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const admin=readFileSync('src/components/ShipmentOperations.tsx','utf8')

describe('customer custody integration semantics',()=>{
  it('resolves auth to one active client and scopes custody and requests to it',()=>{expect(launch).toContain('ca.auth_user_id=auth.uid()');expect(launch).toContain("ca.status='active'");expect((migration.match(/public\.current_customer_client\(\)/g)??[]).length).toBeGreaterThanOrEqual(2);expect(migration).toContain('sh.client_id = r.client_id')})
  it('keeps reserved and shipping allocations in physical custody',()=>{const custody=migration.slice(migration.indexOf('create function public.customer_custody()'),migration.indexOf('grant execute on function public.customer_custody()'));expect(custody).toContain("a.status in ('reserved', 'shipping')");expect(custody).not.toMatch(/update public\.inventory_allocations|physical_ml\s*=/)})
  it('preserves post_shipment as the existing custody exit',()=>{expect(staff).toContain("update public.inventory_allocations set status = 'shipping'");expect(migration).not.toContain('create or replace function public.post_shipment')})
  it('renders all four customer-facing buckets and preserves committed perfumes',()=>{for(const copy of ['Disponível para envio','Aguardando sua aprovação','Em preparação','Em transporte','sob os cuidados da RUAH','Em solicitação:','APROVAR ENVIO'])expect(portal).toContain(copy)})
  it('contains no administrative customer-approval button or RPC call',()=>{expect(admin).not.toContain('APROVADO PELO CLIENTE');expect(admin).not.toContain('approve_shipment_for_label')})
})
