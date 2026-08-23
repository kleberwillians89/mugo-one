import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const fix = readFileSync('supabase/migrations/202608230011_fix_davi_sale_original_allocation_quantity.sql', 'utf8')
const receipt = readFileSync('supabase/migrations/202608230010_inventory_station_preparation.sql', 'utf8')

const sync = fix.slice(fix.indexOf('create or replace function public.sync_sale_inventory_allocation'))

describe('P0 Davi cria venda sem fabricar estoque e reserva quantidade original', () => {
  it('faz true replace da RPC com a mesma assinatura e permissões', () => {
    expect(fix).toContain('create or replace function public.davi_excel_create_sale(p_payload jsonb,p_idempotency_key text)')
    expect(fix).toContain('returns uuid language plpgsql security definer set search_path=public')
    expect(fix).toContain("has_org_permission(org,'sales.edit')")
    expect(fix).toContain('grant execute on function public.davi_excel_create_sale(jsonb,text) to authenticated')
  })

  it('sem inventory_item a venda existe sem allocation, movimento, físico ou RUAH-P', () => {
    expect(sync).toContain('if not found or new.sale_date<v_item.reference_date then return new; end if;')
    expect(sync).not.toContain('insert into public.inventory_items')
    expect(sync).not.toContain('insert into public.inventory_movements')
    expect(sync).not.toContain('ensure_perfume_operational_code')
    expect(sync).not.toMatch(/physical_ml\s*=/)
  })

  it('com estoque real reserva volume inicial em quantity e original_quantity', () => {
    expect(sync).toContain('quantity_ml,original_quantity_ml')
    expect(sync).toContain('new.volume_ml,new.volume_ml')
    expect(sync).toContain("'operational_stock',true")
    expect(sync).toContain('available_ml=available_ml-new.volume_ml')
  })

  it('venda não aumenta físico, cria movimento ou gera outro RUAH-P', () => {
    expect(sync).not.toMatch(/physical_ml\s*=\s*physical_ml\s*\+/)
    expect(sync).not.toContain('inventory_apply(')
    expect(sync).not.toContain('inventory_physical_receipt')
    expect(sync).not.toContain('ensure_perfume_operational_code')
  })

  it('idempotência evita venda e allocation duplicadas', () => {
    expect(fix).toContain("source='davi_excel' and import_signature=p_idempotency_key")
    expect(fix).toContain('exception when unique_violation')
    expect(sync).toContain("where sale_id=new.id and allocation_source='operational_stock' and status in('reserved','shipping','shipped') for update")
    expect(sync).toContain('if v_allocation.id is null then')
  })

  it('recebimento posterior mantém reconciliação canônica e o mesmo RUAH-P', () => {
    expect(receipt).toContain('code:=public.ensure_perfume_operational_code(p_perfume_id)')
    expect(receipt).toContain('quantity_ml,original_quantity_ml')
    expect(receipt).toContain('p_perfume_id,s.volume_ml,s.volume_ml')
    expect(receipt).toContain('on conflict(organization_id,perfume_id) do nothing')
  })
})
