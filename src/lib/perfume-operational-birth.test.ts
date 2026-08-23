import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const records=readFileSync('src/lib/records.ts','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')
const identity=readFileSync('supabase/migrations/202608220003_perfume_preparation_batches.sql','utf8')
const label=readFileSync('src/pages/PerfumePrintLabelPage.tsx','utf8')
const labelCss=readFileSync('src/pages/PerfumePrintLabelPage.css','utf8')
const preparation=readFileSync('src/lib/preparation.ts','utf8')
const station=readFileSync('src/pages/InventoryStationPage.tsx','utf8')
const davi=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const physical=readFileSync('supabase/migrations/202608230005_preparation_sale_type.sql','utf8')
const stationFlow=readFileSync('supabase/migrations/202608230010_inventory_station_preparation.sql','utf8')

describe('RUAH-P nasce na primeira entrada física do perfume',()=>{
 it('banco gera formato tenant-safe, único e concorrente',()=>{expect(identity).toContain("'RUAH-P'||lpad(seq::text,6,'0')");expect(identity).toContain('perfume_operational_sequences');expect(identity).toContain('on conflict(organization_id) do update');expect(identity).toContain('perfumes_org_operational_code_uidx')})
 it('catálogo aceita código nulo, mas identidade emitida continua imutável',()=>{expect(physical).toContain('alter column operational_code drop not null');expect(physical).toContain("raise exception 'operational_code_immutable'");const creation=records.slice(records.indexOf('export async function createCanonicalPerfume'),records.indexOf('export type InventorySummary'));expect(creation).not.toMatch(/operational_code\s*:/);expect(creation).toContain("select('id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier,operational_code')")})
 it('primeira entrada física gera RUAH-P sem trigger genérico e frontend rejeita recebimento sem código',()=>{expect(physical).toContain('code:=public.ensure_perfume_operational_code(p_perfume_id)');expect(physical).not.toContain('create trigger inventory_item_assign_perfume_code');expect(physical).toContain('inventory_receive_perfume');expect(inventory).toContain("/^RUAH-P\\d{6}$/.test(operational.operational_code??'')");expect(inventory).toContain('A entrada foi registrada, mas a identidade operacional não foi retornada')})
 it('duplicidade reutiliza perfume e o mesmo operational_code',()=>{expect(records).toContain('findEquivalentPerfumes(name)');expect(records).toContain('return{perfume:equivalent[0],created:false}');expect(inventory).toContain('USAR ESTE PERFUME');expect(inventory).toContain('similar.operational_code')})
 it('sucesso do recebimento mostra identidade e permite imprimir imediatamente',()=>{for(const text of ['PERFUME RECEBIDO','CÓDIGO OPERACIONAL','Entrada física registrada','Etiqueta pronta para impressão','IMPRIMIR ETIQUETA','CONCLUIR'])expect(inventory).toContain(text);expect(inventory).toContain('printPerfumeLabel(success)');expect(inventory).toContain('REIMPRIMIR ETIQUETA');expect(inventory).toContain('canonical?.operational_code&&')})
 it('etiqueta isolada mede 70x30 e usa o mesmo payload validado em Code128, QR e texto',()=>{expect(label).toContain('@page { size: 70mm 30mm; margin: 0; }');expect(labelCss).toContain('width: 70mm');expect(labelCss).toContain('height: 30mm');expect(label).toContain('<BarcodeImage value={label.operational_code}');expect(label).toContain('<QrCodeImage value={label.operational_code}');expect(label).toContain('<code>{label.operational_code}</code>');expect(preparation).toContain('codes:perfume.operational_code')})
 it('impressão depende somente do perfume e não de venda, cliente ou shipment',()=>{const fn=preparation.slice(preparation.indexOf('export function printPerfumeLabel'));for(const forbidden of ['sale_id','client_id','shipment_id'])expect(fn).not.toContain(forbidden)})
 it('scan resolve o perfume, inclusive sem vendas, e não altera nada no preview',()=>{expect(preparation).toContain('previewInventoryStation');expect(preparation).toContain('resolvePerfumeOperationalCode(code)');expect(preparation).toContain('fetchPreparationCandidates');expect(station).toContain('Nenhuma venda aguarda preparação para este perfume.');expect(station).toContain('O bip apenas identificou o perfume. Nada foi alterado.')})
 it('vendas anteriores e posteriores são resolvidas dinamicamente pelo mesmo perfume_id',()=>{expect(stationFlow).toContain('sale.perfume_id=p_perfume_id');expect(stationFlow).not.toContain('sale.sale_date>=item.reference_date');expect(stationFlow).toContain('perfume_id,quantity_ml');expect(stationFlow).toContain('p_perfume_id,s.volume_ml');expect(davi).toContain('perfumeId:row.perfume!.id')})
 it('confirmação humana cria preparação canônica sem nova entrada física',()=>{expect(station).toContain('confirmInventoryStationPreparation(perfume.operational_code');expect(station).toContain('CONFIRMAR PREPARAÇÃO');const wrapper=stationFlow.slice(stationFlow.indexOf('inventory_station_confirm_preparation'));for(const forbidden of ['inventory_apply(','post_shipment(','superfrete'])expect(wrapper).not.toContain(forbidden)})
 it('RUAH-F/S não substituem P na etiqueta canônica',()=>{expect(label).toContain('/^RUAH-P\\d{6}$/');expect(label).not.toMatch(/RUAH-[FS]/)})
})
