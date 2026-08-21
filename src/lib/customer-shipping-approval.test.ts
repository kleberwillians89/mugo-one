import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608210002_customer_shipping_approval.sql','utf8')
const admin=readFileSync('src/components/ShipmentOperations.tsx','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')

const confirm=migration.slice(migration.indexOf('create or replace function public.customer_shipment_request_confirm'),migration.indexOf('commit;'))

describe('customer-owned shipping approval',()=>{
  it('removes staff approval from UI and authenticated RPC access',()=>{expect(admin).not.toContain('APROVADO PELO CLIENTE');expect(admin).not.toContain('approveShipmentForLabel');expect(records).not.toContain('approve_shipment_for_label');expect(migration).toContain('revoke execute on function public.approve_shipment_for_label(uuid) from authenticated')})
  it('derives ownership from auth and never accepts browser identity fields',()=>{expect(confirm).toContain('public.current_customer_client()');expect(confirm).toContain('client_id = v_client_id');expect(confirm).not.toMatch(/p_client_id|p_organization_id|p_auth_user_id/)})
  it('validates the exact current quote snapshot',()=>{for(const field of ['selected_quote_id','shipping_price','carrier','service','service_id'])expect(confirm).toContain(field);expect(confirm).toContain("raise exception 'quote_changed'")})
  it('is idempotent and emits one privacy-safe audit event',()=>{expect(confirm).toContain("if v_shipment.status = 'customer_approved' then return v_request");expect(confirm).toContain("'customer_shipping_confirmed'");expect(confirm).not.toMatch(/cpf|address|password|token/i)})
  it('does not buy freight, post, or touch inventory',()=>{expect(confirm).not.toMatch(/checkout|superfrete|post_shipment|physical_ml|inventory_allocations/)})
  it('invalidates approval when the quote snapshot changes',()=>{expect(migration).toContain("old.status = 'customer_approved'");expect(migration).toContain("new.status := 'awaiting_customer_approval'");expect(migration).toContain('new.customer_approved_at := null')})
  it('shows customer approval only in Minha RUAH and read-only state to staff',()=>{expect(portal).toContain('AGUARDANDO SUA APROVAÇÃO');expect(portal).toContain('APROVAR ENVIO');expect(portal).toContain('✓ ENVIO APROVADO');expect(admin).toContain('✓ APROVADO PELA CLIENTE');expect(admin).toContain('via Minha RUAH')})
})
