import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const records=readFileSync('src/lib/records.ts','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const identity=readFileSync('supabase/migrations/202608220003_perfume_preparation_batches.sql','utf8')
const receipt=readFileSync('supabase/migrations/202608220004_perfume_receipt_by_scan.sql','utf8')
const label=readFileSync('src/pages/PerfumePrintLabelPage.tsx','utf8')
const labelCss=readFileSync('src/pages/PerfumePrintLabelPage.css','utf8')
const preparation=readFileSync('src/lib/preparation.ts','utf8')
const station=readFileSync('src/pages/InventoryStationPage.tsx','utf8')
const davi=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')

describe('RUAH-P nasce no cadastro canônico do perfume',()=>{
 it('banco gera formato tenant-safe, único e concorrente',()=>{expect(identity).toContain("'RUAH-P'||lpad(seq::text,6,'0')");expect(identity).toContain('perfume_operational_sequences');expect(identity).toContain('on conflict(organization_id) do update');expect(identity).toContain('perfumes_org_operational_code_uidx')})
 it('código é obrigatório, imutável e browser não fornece a numeração',()=>{expect(identity).toContain('alter column operational_code set not null');expect(identity).toContain('operational_code_immutable');expect(identity).toContain('operational_code_generated_by_database');const creation=records.slice(records.indexOf('export async function createCanonicalPerfume'),records.indexOf('export type InventorySummary'));expect(creation).not.toMatch(/operational_code\s*:/);expect(creation).toContain("select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code')")})
 it('frontend rejeita sucesso sem RUAH-P real retornado',()=>{expect(records).toContain("/^RUAH-P\\d{6}$/.test(perfume.operational_code??'')");expect(inventory).toContain("/^RUAH-P\\d{6}$/.test(selected.operational_code??'')");expect(inventory).toContain('Código operacional indisponível')})
 it('duplicidade reutiliza perfume e o mesmo operational_code',()=>{expect(records).toContain('findEquivalentPerfumes(name)');expect(records).toContain('return{perfume:equivalent[0],created:false}');expect(inventory).toContain('USAR ESTE PERFUME');expect(inventory).toContain('similar.operational_code')})
 it('sucesso mostra identidade e permite imprimir imediatamente',()=>{for(const text of ['PERFUME CADASTRADO','CÓDIGO OPERACIONAL','Código operacional criado','Etiqueta pronta para impressão','IMPRIMIR ETIQUETA','CONCLUIR'])expect(inventory).toContain(text);expect(inventory).toContain('printPerfumeLabel(success)');expect(inventory).toContain('REIMPRIMIR ETIQUETA')})
 it('etiqueta isolada mede 70x30 e usa o mesmo payload em Code128, QR e texto',()=>{expect(label).toContain('@page { size: 70mm 30mm; margin: 0; }');expect(labelCss).toContain('width: 70mm');expect(labelCss).toContain('height: 30mm');expect(label).toContain('<BarcodeImage value={code}');expect(label).toContain('<QrCodeImage value={code}');expect(label).toContain('<code>{code}</code>');expect(preparation).toContain('codes:perfume.operational_code')})
 it('impressão depende somente do perfume e não de venda, cliente ou shipment',()=>{const fn=preparation.slice(preparation.indexOf('export function printPerfumeLabel'));for(const forbidden of ['sale_id','client_id','shipment_id'])expect(fn).not.toContain(forbidden)})
 it('scan resolve o perfume, inclusive sem vendas, e não altera nada no preview',()=>{const preview=receipt.slice(receipt.indexOf('perfume_receipt_preview'),receipt.indexOf('perfume_receipt_confirm'));expect(preview).toContain("'perfume_id',p.id");expect(preview).toContain("'operational_code',p.operational_code");expect(preview).toContain("'sales',rows");expect(preview).not.toMatch(/\b(insert|update|delete)\b/i);expect(station).toContain('Nenhuma venda validada aguarda a chegada deste perfume.');expect(station).toContain('O bip apenas identificou o perfume. Nada foi alterado.')})
 it('vendas posteriores são resolvidas dinamicamente pelo mesmo perfume_id',()=>{expect(receipt).toContain('s.perfume_id=p.id');expect(receipt).toContain('a.perfume_id=s.perfume_id');expect(davi).toContain('perfumeId:row.perfume!.id')})
 it('confirmação humana reutiliza 220004 e não cria shipment, preparation ou movimento físico',()=>{expect(station).toContain('confirmPerfumeReceipt(perfume.operational_code');expect(station).toContain('CONFIRMAR RECEBIMENTO');for(const forbidden of ['shipments','preparation_batches','physical_ml'])expect(receipt.slice(0,receipt.indexOf('-- Minha RUAH'))).not.toContain(forbidden)})
 it('RUAH-F/S não substituem P na etiqueta canônica',()=>{expect(label).toContain('/^RUAH-P\\d{6}$/');expect(label).not.toMatch(/RUAH-[FS]/)})
})
