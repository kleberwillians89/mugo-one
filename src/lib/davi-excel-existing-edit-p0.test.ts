import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const migration=readFileSync('supabase/migrations/202608230008_davi_excel_safe_existing_sale_update.sql','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')

describe('P0 edição segura de vendas existentes no Davi Excel',()=>{
 it('edita a mesma sale por id e nunca reutiliza criação',()=>{expect(page).toContain('fetchDaviExcelSaleEdit(row.id)');expect(page).toContain('updateDaviExcelSale(row.id');expect(page).not.toContain('createSale(row');expect(migration).toContain('where id=p_sale_id');expect(migration).not.toContain('insert into public.sales')})
 it('oferece edição explícita, cancelamento e salvar todas sem persistir no blur',()=>{expect(page).toContain('SALVAR TODAS AS ALTERAÇÕES');expect(page).toContain('>SALVAR</button>');expect(page).toContain('>CANCELAR</button>');expect(page).not.toContain('onBlur={save}')})
 it('cobre os campos comerciais canônicos',()=>{for(const field of ['client_id','sale_date','shipping_deadline_date','shipping_deadline_raw','shipped_at','sale_type','volume_ml','perfume_id','amount','payment_status','payment_method','paid_at','credit_reference_amount','notes'])expect(migration).toContain(`'${field}'`)})
 it('valida tenant, RBAC e concorrência otimista',()=>{expect(migration).toContain("has_org_permission(before_row.organization_id,'sales.edit')");expect(migration).toContain('organization_id=before_row.organization_id');expect(migration).toContain('before_row.updated_at is distinct from p_expected_updated_at');expect(page).toContain('Esta venda foi atualizada por outra pessoa')})
 it('preserva shipment congelado e exige confirmação operacional',()=>{expect(migration).toContain('operational_confirmation_required');expect(migration).toContain('shipment_controls_shipping_date');expect(migration).not.toMatch(/update public\.shipment_items|update public\.shipments|post_shipment/);expect(page).toContain('o shipment e seus itens permanecerão congelados')})
 it('audita before, after, ator e campos alterados',()=>{expect(migration).toContain("'davi_excel_sale_updated'");expect(migration).toContain("'before',to_jsonb(before_row)");expect(migration).toContain("'after',to_jsonb(after_row)");expect(migration).toContain("'changed_fields',changed");expect(migration).toContain('auth.uid()')})
 it('perfume novo é somente catálogo',()=>{expect(page).toContain('createCanonicalPerfume');expect(page).toContain('Perfume adicionado somente ao catálogo.');const edit=records.slice(records.indexOf('export async function updateDaviExcelSale'),records.indexOf('export async function fetchDaviExcelDistinct'));expect(edit).not.toMatch(/inventory|physical_ml|operational_code/)})
})

describe('lacunas reais de estoque',()=>{
 it('mínimo usa RPC própria, permissão e auditoria',()=>{expect(inventory).toContain('updateInventoryMinimum(balance.item_id,minimum)');expect(migration).toContain('inventory_update_minimum');expect(migration).toContain("'inventory.adjust'");expect(migration).toContain("'inventory_minimum_updated'")})
 it('shipping não é apresentado como preparação',()=>{expect(inventory).toContain('<dt>Em envio</dt>');expect(inventory).toContain('<dt>Em preparo</dt>')})
})
