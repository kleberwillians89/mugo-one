import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sql=readFileSync('supabase/migrations/202608220004_perfume_receipt_by_scan.sql','utf8')
const station=readFileSync('src/pages/InventoryStationPage.tsx','utf8')
const api=readFileSync('src/lib/perfume-receipt.ts','utf8')
const stationSql=readFileSync('supabase/migrations/202608230010_inventory_station_preparation.sql','utf8')

describe('recebimento canônico por RUAH-P',()=>{
  it('bip monta preview read only antes de qualquer confirmação',()=>{expect(station.indexOf('previewInventoryStation')).toBeLessThan(station.indexOf('CONFIRMAR PREPARAÇÃO'));expect(station).toContain('O bip apenas identificou o perfume. Nada foi alterado.');const confirm=stationSql.slice(stationSql.indexOf('inventory_station_confirm_preparation'));expect(station.indexOf('previewInventoryStation')).toBeGreaterThan(-1);expect(confirm).toContain('preparation_batch_create')})
  it('lista somente vendas pagas, reservadas, não excluídas e ainda não recebidas',()=>{expect(sql).toContain("a.status='reserved'");expect(sql).toContain("s.payment_status='paid'");expect(sql).toContain('s.deleted_at is null');expect(sql).toContain('s.shipping_availability_confirmed_at is null')})
  it('confirma exatamente o snapshot de sale_ids e revalida perfume e organização',()=>{expect(api).toContain('p_sale_ids:saleIds');expect(sql).toContain('s.id=any(normalized)');expect(sql).toContain('s.organization_id=p.organization_id');expect(sql).toContain('s.perfume_id=p.id');expect(sql).toContain("raise exception 'receipt_snapshot_changed'")})
  it('é idempotente e não duplica auditoria em double click',()=>{expect(sql).toContain('shipping_availability_confirmed_at=coalesce');expect(sql).toContain('if changed>0 then');expect(sql).toContain("'already_confirmed',changed=0")})
  it('audita usuário, perfume, código, vendas, quantidade e ml',()=>{for(const value of ['auth.uid()','perfume_id','operational_code','sale_ids','sale_count','total_ml'])expect(sql).toContain(value)})
  it('não altera físico, preparação, shipment, split ou SuperFrete',()=>{const confirm=sql.slice(sql.indexOf('create function public.perfume_receipt_confirm'),sql.indexOf('grant execute on function public.perfume_receipt_confirm'));for(const forbidden of ['physical_ml','preparation_batch','shipment_items','inventory_split_units','post_shipment','superfrete'])expect(confirm.toLowerCase()).not.toContain(forbidden)})
  it('Minha RUAH exige recebimento confirmado e preparação real',()=>{expect(sql).toContain('s.shipping_availability_confirmed_at is not null');expect(sql).toContain("b.status='confirmed'");expect(sql).toContain('not coalesce(received,false)');expect(sql).not.toContain("shipping_availability_kind='available_now'")})
  it('protege escrita por permissão e remove execução pública/anon',()=>{expect(sql).toContain("has_org_permission(p.organization_id,'inventory.adjust')");expect(sql).toContain('security definer set search_path=public');expect(sql).toContain('revoke all on function public.perfume_receipt_confirm(text,uuid[]) from public,anon')})
})
