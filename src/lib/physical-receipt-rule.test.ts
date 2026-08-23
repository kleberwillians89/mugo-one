import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const sql=readFileSync('supabase/migrations/202608230005_preparation_sale_type.sql','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const davi=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const label=readFileSync('src/pages/PerfumePrintLabelPage.tsx','utf8')

describe('perfume comercial versus recebimento físico',()=>{
 it('catálogo aceita perfume sem estoque e sem RUAH-P',()=>{expect(sql).toContain('operational_code drop not null');expect(records).not.toContain('O perfume foi criado, mas o código operacional não foi retornado');expect(davi).toContain('Nenhum estoque foi criado.')})
 it('RUAH-P nasce somente na RPC de recebimento, nunca em insert genérico de item',()=>{expect(sql).toContain('code:=public.ensure_perfume_operational_code(p_perfume_id)');expect(sql).not.toContain('create trigger inventory_item_assign_perfume_code');expect(sql).toContain("'RUAH-P'||lpad(seq::text,6,'0')")})
 it('recebimento exige ml positivo, escreve ledger e é idempotente',()=>{expect(sql).toContain('p_received_ml is null or p_received_ml<=0');expect(sql).toContain("public.inventory_apply(item.id,p_received_ml,'entry'");expect(sql).toContain('pg_advisory_xact_lock');expect(sql).toContain("action='inventory_physical_receipt'");expect(sql).toContain('idempotency_key_reused_with_different_payload')})
 it('segunda entrada reutiliza item e código, somando novo movimento',()=>{expect(sql).toContain('on conflict(organization_id,perfume_id) do nothing');expect(sql).toContain('if p.operational_code is not null then return p.operational_code')})
 it('modal registra recebimento antes de liberar etiqueta',()=>{expect(inventory.indexOf('receiveInventoryPerfume({')).toBeLessThan(inventory.indexOf('fetchCanonicalPerfume(selected.id)'));expect(inventory).toContain('Informe quantos ml foram recebidos fisicamente.')})
 it('rota de etiqueta valida recebimento no banco e ignora nome ou marca da URL',()=>{expect(sql).toContain('perfume_received_label');expect(sql).toContain("a.action='inventory_physical_receipt'");expect(label).toContain("rpc('perfume_received_label'");expect(label).not.toContain("params.get('perfume')");expect(label).not.toContain("params.get('brand')")})
 it('venda não chama recebimento nem cria inventory_item',()=>{const createSale=records.slice(records.indexOf('export async function createSale'),records.indexOf('export async function parseSaleAssistant'));expect(createSale).not.toMatch(/inventory_(?:receive|create|apply)/);expect(davi).not.toContain("window.open('/estoque'")})
})
