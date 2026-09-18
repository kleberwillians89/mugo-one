import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202609110001_team_shipping_approval.sql','utf8')
const admin=readFileSync('src/components/ShipmentOperations.tsx','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')

describe('team-owned shipping approval',()=>{
  it('restores the staff approval RPC and removes customer execution',()=>{expect(admin).toContain('approveShipmentForLabel');expect(records).toContain("supabase!.rpc('approve_shipment_for_label'");expect(migration).toContain('grant execute on function public.approve_shipment_for_label(uuid) to authenticated,service_role');expect(migration).toContain('revoke execute on function public.customer_shipment_confirm(uuid) from authenticated')})
  it('authorizes the team through the granular shipping.label permission',()=>{expect(migration).toContain("public.has_org_permission(v_shipment.organization_id,'shipping.label')");expect(migration).not.toMatch(/p_client_id|p_organization_id|p_auth_user_id/)})
  it('validates the exact current quote snapshot',()=>{for(const field of ['selected_quote_id','shipping_price','carrier','service','service_id'])expect(migration).toContain(field);expect(migration).toContain("raise exception 'quote_changed'")})
  it('is idempotent and emits a privacy-safe team audit event',()=>{expect(migration).toContain("if v_shipment.status='customer_approved' then return v_shipment");expect(migration).toContain("'team_shipping_approved'");expect(migration).toContain("'source','ruah_team'");expect(migration).not.toMatch(/cpf|address|password|token/i)})
  it('does not buy freight, post, or touch inventory',()=>{expect(migration).not.toMatch(/checkout|post_shipment|physical_ml|inventory_allocations/)})
  it('shows approval to staff and only status tracking to the customer',()=>{expect(admin).toContain('APROVAR FRETE PELO TIME');expect(admin).toContain('✓ APROVADO PELO TIME');expect(portal).toContain('EM APROVAÇÃO');expect(portal).toContain('Nenhuma ação é necessária');expect(portal).not.toContain('confirmCustomerShipment')})
})
