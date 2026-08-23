import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const ui=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const sql=readFileSync('supabase/migrations/202608220007_davi_excel_sale_input.sql','utf8')

describe('entrada canônica de vendas no Davi Excel',()=>{
 it('mantém rascunhos locais, múltiplas linhas e campos read only',()=>{expect(ui).toContain('ADICIONAR LINHA');expect(ui).toContain('SALVAR TODAS AS LINHAS VÁLIDAS');expect(ui).toContain('davi-readonly');expect(ui).toContain('rascunho')})
 it('usa autocomplete e exige IDs reais de cliente e perfume',()=>{expect(ui).toContain('searchClients');expect(ui).toContain('searchPerfumes');expect(ui).toContain("if(!row.client)return row.clientCandidates.length");expect(ui).toContain("if(!row.perfume)return row.perfumeCandidates.length")})
 it('valida datas brasileiras, ml e moeda brasileira',()=>{expect(ui).toContain("match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/)");expect(ui).toContain("replace(/\\./g,'').replace(',','.')");expect(ui).toContain("decimal(row.ml)===null||decimal(row.ml)!<=0")})
 it('oferece TAB nativo, Ctrl/Cmd Enter, Escape e remoção somente do rascunho',()=>{expect(ui).toContain("event.ctrlKey||event.metaKey");expect(ui).toContain("event.key==='Enter'");expect(ui).toContain("event.key==='Escape'");expect(ui).toContain('Remover rascunho');expect(ui).not.toContain("event.key==='Delete'")})
 it('distribui colagem simples e múltipla e exige revisão de vínculos ambíguos',()=>{expect(ui).toContain("split(/\\r?\\n/)");expect(ui).toContain("line.split('\\t')");expect(ui).toContain("exactClients.length===1");expect(ui).toContain('Cliente ambíguo.');expect(ui).toContain('Perfume ambíguo.')})
 it('reutiliza createSale com origem e idempotência próprias',()=>{expect(ui).toContain("source:'davi_excel'");expect(ui).toContain('idempotencyKey:row.key');expect(records).toContain("input.source==='davi_excel'");expect(records).toContain("rpc('davi_excel_create_sale'")})
 it('RPC é tenant scoped, permissionada, idempotente e auditada',()=>{expect(sql).toContain("has_org_permission(org,'sales.edit')");expect(sql).toContain('organization_id=org');expect(sql).toContain("source='davi_excel'");expect(sql).toContain('created_by');expect(sql).toContain('auth.uid()');expect(sql).toContain('unique_violation');expect(sql).toContain('security definer set search_path=public');expect(sql).toContain('revoke all')})
 it('criação não toca shipment, physical_ml, preparation ou SuperFrete',()=>{for(const forbidden of ['shipments','shipment_items','physical_ml','preparation_batch','superfrete','post_shipment'])expect(sql.toLowerCase()).not.toContain(forbidden)})
 it('linhas locais permanecem acima dos resultados filtrados e somente editores veem criação',()=>{expect(page).toContain('canEdit&&<div className="davi-new-rows-shell"');expect(page.indexOf('DaviExcelNewRows')).toBeLessThan(page.indexOf('rows.map'))})
})
