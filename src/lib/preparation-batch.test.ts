import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {parseScannedValue} from './bottle-scan'
const sql=readFileSync(new URL('../../supabase/migrations/202608220003_perfume_preparation_batches.sql',import.meta.url),'utf8')
const page=readFileSync(new URL('../pages/PreparationPage.tsx',import.meta.url),'utf8')
const label=readFileSync(new URL('../pages/PerfumePrintLabelPage.css',import.meta.url),'utf8')
const labelPage=readFileSync(new URL('../pages/PerfumePrintLabelPage.tsx',import.meta.url),'utf8')
const custody=sql.slice(sql.indexOf('create function public.customer_custody()'),sql.indexOf('create or replace function public.customer_shipment_request_create_prepared'))
describe('um código por perfume e fracionamento em lote',()=>{
 it('gera código tenant-safe, atômico, único, imutável e somente no banco',()=>{expect(sql).toContain("'RUAH-P'||lpad(seq::text,6,'0')");expect(sql).toContain('perfumes_org_operational_code_uidx');expect(sql).toContain('operational_code_immutable');expect(sql).toContain('operational_code_generated_by_database')})
 it('QR e Code128 compartilham o P-code',()=>{expect(parseScannedValue('RUAH-P000123')).toEqual({kind:'perfume',value:'RUAH-P000123'});expect(page).toContain('operational_code')})
 it('mantém F e S legados',()=>{expect(parseScannedValue('RUAH-F000185')).toEqual({kind:'code',value:'F000185'});expect(parseScannedValue('RUAH-S000185-001')).toEqual({kind:'split',value:'S000185-001'})})
 it('trava allocations e impede excesso parcial concorrente',()=>{expect(sql).toContain('for update of a');expect(sql).toContain("raise exception 'preparation_quantity_exceeded'");expect(sql).toContain('original_quantity_ml')})
 it('scan apenas identifica e confirmação é separada/idempotente',()=>{expect(sql).toContain("status='identified'");expect(sql).toContain("if b.status='confirmed' then return jsonb_build_object");expect(page).toContain('CONFIRMAR PREPARAÇÃO?')})
 it('não cria split, não baixa físico e não chama post na confirmação',()=>{const fn=sql.slice(sql.indexOf('public.preparation_batch_confirm('),sql.indexOf('public.preparation_batch_cancel('));expect(fn).not.toContain('inventory_split_units');expect(fn).not.toContain('physical_ml');expect(fn).not.toContain('post_shipment')})
 it('preserva origem e exige escolha quando rastreada',()=>{expect(sql).toContain("tracking='active' then raise exception 'source_bottle_required'");expect(sql).toContain('source_bottle_id')})
 it('limita portal à quantidade preparada',()=>{expect(sql).toContain('prepared-requested');expect(sql).toContain('requestable_quantity_ml')})
 it('previsão comercial nunca substitui confirmação física',()=>{expect(sql).toContain("s.shipping_availability_kind='available_now' or s.shipping_availability_confirmed_at is not null");expect(sql).not.toContain("shipping_available_date<=current_date")})
 it('revoga execução pública de todos os RPCs security definer novos',()=>{for(const signature of ['preparation_candidates(uuid)','preparation_batch_create(uuid,jsonb)','preparation_batch_identify(uuid,text)','preparation_batch_confirm(uuid)','preparation_batch_cancel(uuid)','create_draft_shipment_from_customer_request(uuid)','post_shipment(uuid)'])expect(sql).toContain(`revoke all on function public.${signature} from public,anon`)})
 it('mantém post_shipment como baixa final e compatibilidade split',()=>{expect(sql).toContain('create or replace function public.post_shipment');expect(sql).toContain("elsif r.split_unit_id is not null")})
 it('etiqueta canônica mede 70 por 30 mm sem escala física',()=>{expect(label).toMatch(/width:\s*70mm/);expect(label).toMatch(/height:\s*30mm/);expect(labelPage).toContain('size: 70mm 30mm');expect(label).not.toMatch(/transform:\s*scale/i)})
 it('QR, Code128 e código humano recebem o mesmo operational_code validado',()=>{expect(labelPage).toContain('BarcodeImage value={label.operational_code}');expect(labelPage).toContain('QrCodeImage value={label.operational_code}');expect(labelPage).toContain('<code>{label.operational_code}</code>');expect(labelPage).not.toMatch(/RUAH-[FS]/)})
 it('mobile evita tabela e oferece controles de 44px',()=>{expect(page).not.toContain('<table');expect(readFileSync(new URL('../pages/PreparationPage.css',import.meta.url),'utf8')).toContain('min-height:44px')})
})

describe('customer_custody preparado e solicitações ativas',()=>{
 const active="(r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled'))"
 it('não agrega UUID com min/max em nenhum RPC da migration',()=>{
   expect(sql).not.toMatch(/\b(?:min|max)\s*\(\s*(?:[a-z_]+\.)?(?:id|request_id|allocation_id|perfume_id|source_bottle_id|shipment_id|converted_shipment_id)\s*\)/i)
 })
 it('A: request ativo retorna request_id',()=>{expect(custody).toContain('(req_current.request_id is not null),req_current.request_id')})
 it('B: múltiplos requests ativos escolhem deterministicamente o mais recente',()=>{expect(custody).toContain('order by r.requested_at desc,r.id desc');expect(custody).toContain('limit 1')})
 it('C: requested_ml soma somente requests ativos',()=>{expect(custody).toContain('select sum(ri.quantity_ml) requested_ml');expect(custody.split(active).length-1).toBe(2)})
 it('D: request cancelado não conta',()=>{expect(active).not.toContain("r.status<>'cancelled'");expect(active).toContain("r.status='requested'")})
 it('E: shipment postado, entregue ou cancelado não conta como aberto',()=>{expect(custody).toContain("sh.status not in('posted','delivered','cancelled')")})
 it('F: request sem shipment continua ativo somente enquanto requested',()=>{expect(custody).toContain("r.status='requested' and r.converted_shipment_id is null")})
 it('G: prepared_quantity_ml continua vindo só de batches confirmados',()=>{expect(custody).toContain("b.status='confirmed'");expect(custody).toContain('coalesce(prep.prepared_ml,0)')})
 it('H: requestable_quantity_ml preserva preparado menos solicitado sem ficar negativo',()=>{expect(custody).toContain('greatest(least(a.quantity_ml,coalesce(prep.prepared_ml,0)-coalesce(req.requested_ml,0)),0)')})
})
