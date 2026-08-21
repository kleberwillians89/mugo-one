import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const migration=readFileSync('supabase/migrations/202608210004_customer_shipment_canonical.sql','utf8')
const data=readFileSync('src/lib/customer-portal.ts','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const css=readFileSync('src/portal/customer-portal.css','utf8')
const admin=readFileSync('src/components/ShipmentOperations.tsx','utf8')
const list=migration.slice(migration.indexOf('create or replace function public.customer_shipments_list'),migration.indexOf('create or replace function public.customer_shipment_confirm'))
const confirm=migration.slice(migration.indexOf('create or replace function public.customer_shipment_confirm'),migration.indexOf('-- Compatibility wrapper'))
const wrapper=migration.slice(migration.indexOf('create or replace function public.customer_shipment_request_confirm'),migration.indexOf('commit;'))

describe('canonical customer shipment approval',()=>{
  it('lists staff and portal shipments directly by authenticated client ownership',()=>{expect(list).toContain('sh.client_id = public.current_customer_client()');expect(list).not.toContain('customer_shipment_requests r');expect(list).toContain("sh.status = 'awaiting_customer_approval'")})
  it('approves the exact owned shipment without requiring a customer request',()=>{expect(confirm).toContain('where id = p_shipment_id and client_id = v_client_id');expect(confirm).toContain("status = 'customer_approved'");expect(confirm).toContain('customer_approved_at = now()');expect(confirm).toContain('approved_by = auth.uid()')})
  it('keeps quote validation, idempotency and tenant isolation',()=>{expect(confirm).toContain("if v_shipment.status = 'customer_approved' then return v_shipment");for(const field of ['selected_quote_id','shipping_price','carrier','service','service_id'])expect(confirm).toContain(field);expect(confirm).toContain("raise exception 'quote_changed'")})
  it('uses the canonical shipment approval as the only mutation path',()=>{expect(wrapper).toContain('perform public.customer_shipment_confirm');expect(wrapper).not.toContain("set status = 'customer_approved'")})
  it('does not touch physical stock, posting or SuperFrete checkout',()=>{expect(confirm).not.toMatch(/physical_ml|post_shipment|checkout|superfrete_order_id|inventory_allocations/)})
  it('merges canonical shipments with only unconverted requests and deduplicates converted ones',()=>{expect(data).toContain("supabase!.rpc('customer_shipments_list')");expect(data).toContain('const shipmentIds=new Set');expect(data).toContain('!shipmentIds.has(item.converted_shipment_id)');expect(data).toContain("supabase!.rpc('customer_shipment_confirm'")})
  it('puts required approval first with a direct CTA and no admin approval action',()=>{expect(portal).toContain('AÇÃO NECESSÁRIA');expect(portal).toContain('Number(b.awaiting_approval)-Number(a.awaiting_approval)');expect(portal).toContain('confirmCustomerShipment');expect(admin).not.toContain('approveShipmentForLabel')})
  it('uses deterministic portal navigation and keeps the bottom nav active',()=>{expect(portal).toContain('FECHAR HISTÓRICO');expect(portal).not.toMatch(/history\.back|navigate\(-1\)/);expect(portal).toContain("if(showHistory)navigate('/minha-ruah');setTab(id)")})
  it('keeps mobile cards constrained without fixed viewport-breaking width',()=>{expect(css).toContain('min-width:0');expect(css).toContain('@media (max-width:390px)');expect(css).not.toMatch(/\.portal-request-card[^}]*width:\s*[4-9]\d\dpx/)})
})
