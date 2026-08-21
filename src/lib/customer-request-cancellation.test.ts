import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608210003_customer_custody_semantics.sql','utf8')
const foundation=readFileSync('supabase/migrations/202608200001_customer_portal.sql','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const admin=readFileSync('src/components/ShipmentOperations.tsx','utf8')
const core=migration.slice(migration.indexOf('create or replace function public.customer_shipment_request_cancel_core'),migration.indexOf('create or replace function public.customer_shipment_request_cancel(p_request_id'))
const customer=migration.slice(migration.indexOf('create or replace function public.customer_shipment_request_cancel(p_request_id'),migration.indexOf('create or replace function public.customer_shipment_request_cancel_staff'))
const staff=migration.slice(migration.indexOf('create or replace function public.customer_shipment_request_cancel_staff'),migration.indexOf('commit;'))

describe('pre-post customer request cancellation',()=>{
  it('locks and cancels the request without deleting request items',()=>{expect(core).toContain('for update');expect(core).toContain("set status = 'cancelled'");expect(core).not.toMatch(/delete from public\.customer_shipment_request/);expect(core).not.toMatch(/delete from public\.customer_shipment_request_items/)})
  it('restores shipping allocations to canonical reserved without physical writes',()=>{expect(core).toContain("set status = 'reserved', shipment_id = null");expect(core).not.toMatch(/physical_ml|available_ml/)})
  it('cancels the linked draft shipment and preserves the historical link',()=>{expect(core).toContain("set status = 'cancelled', cancelled_at = now()");expect(core).not.toMatch(/converted_shipment_id\s*=\s*null/)})
  it('allows only the owning customer and authorized staff wrappers',()=>{expect(customer).toContain('public.current_customer_client()');expect(customer).not.toMatch(/p_client_id/);expect(staff).toContain("public.has_org_role(v_request.organization_id, array['admin','manager','operator']");expect(staff).toContain("raise exception 'forbidden'")})
  it('keeps cancelled request items out of availability while active ones still block duplicates',()=>{expect(migration).toContain("where status <> 'cancelled'");expect(foundation).toContain("r.status <> 'cancelled'")})
  it('resolves the related open task and audits the cancellation',()=>{expect(core).toContain("entity_type = 'customer_shipment_request'");expect(core).toContain('resolved_at = coalesce');expect(core).toContain("'customer_request_cancelled'")})
  it('stops before any external shipping cancellation is needed',()=>{expect(core).toContain("raise exception 'external_shipping_cancellation_requires_review'");expect(core).not.toMatch(/checkoutSuperFrete|superfrete-create-label|post_shipment/)})
  it('exposes cancellation to customer and staff through the shared core',()=>{expect(portal).toContain('NÃO QUERO ENVIAR AGORA');expect(admin).toContain('cancelCustomerShipmentRequestAsStaff');expect(customer).toContain('customer_shipment_request_cancel_core');expect(staff).toContain('customer_shipment_request_cancel_core')})
})
