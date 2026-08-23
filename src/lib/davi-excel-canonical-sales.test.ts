import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const ui=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const sales=readFileSync('src/pages/SalesPage.tsx','utf8')
const client=readFileSync('src/pages/ClientDetailsPage.tsx','utf8')
const sql=readFileSync('supabase/migrations/202608220007_davi_excel_sale_input.sql','utf8')
const dataset=readFileSync('supabase/migrations/202608220006_davi_excel_column_filters.sql','utf8')

describe('Davi Excel como entrada canônica de vendas',()=>{
 it('rascunho permanece exclusivamente local até ação explícita',()=>{expect(ui).toContain('useState<Draft[]>([fresh()])');expect(ui).not.toContain("from('davi_excel_rows')");expect(ui).not.toContain('useEffect(()=>save');expect(ui).toContain('onClick={()=>save(row)}');expect(ui).toContain('event.ctrlKey||event.metaKey');expect(ui).toContain('onClick={saveAll}')})
 it('cada salvamento chama a RPC 220007 e usa o UUID retornado',()=>{expect(records).toContain("rpc('davi_excel_create_sale'");expect(records).toContain('return{id:String(data),alreadyExisted:false}');expect(ui).toContain('saleId:result.id');expect(ui).toContain('setLastSaleId(result.id)');expect(ui).toContain('ABRIR VENDA 360')})
 it('grava IDs canônicos, campos comerciais, origem e auditoria em sales',()=>{for(const value of ['client.id','perfume.id','sale_date','volume_ml','amount','payment_status','payment_method','paid_at','notes',"'davi_excel'",'created_by'])expect(sql).toContain(value);expect(sql).toContain('return sale_id')})
 it('pago conserva paid_at e aguardando não inventa data',()=>{expect(sql).toContain("case when status='paid'");expect(records).toContain("input.status==='paid'?input.paidAt||null:null")})
 it('refresh lê novamente sales e a mesma venda alimenta Davi, Vendas, Venda 360 e Cliente 360',()=>{expect(ui).toContain('await onCreated()');expect(page).toContain('fetchDaviExcel');expect(dataset).toContain('from public.sales s');expect(sales).toContain('fetchSalesPage');expect(records).toContain("from('sales').select");expect(records).toContain('fetchSale360');expect(client).toContain('data.history')})
 it('lote é transacional por linha, agrega criadas/existentes/falhas e conserva falhas',()=>{expect(ui).toContain('for(const row of rows)results.push(await save');expect(ui).toContain("result.status==='created'");expect(ui).toContain("result.status==='existing'");expect(ui).toContain("result.status==='failed'");expect(ui).toContain('falha${failed');expect(ui).toContain("patch(row.key,{saving:false,error")})
 it('idempotência detecta retry e bloqueia concorrência local',()=>{expect(records).toContain("eq('import_signature',input.idempotencyKey)");expect(records).toContain('alreadyExisted:true');expect(ui).toContain('inFlight.current.get(row.key)');expect(sql).toContain('sales_org_davi_idempotency_uidx');expect(sql).toContain('unique_violation')})
 it('edição de sale_id usa update, nunca insert, e Backspace não exclui',()=>{expect(page).toContain('updateDaviExcelSale(row.id');expect(records).toContain("rpc('davi_excel_update'");expect(page).not.toContain('createSale(row');expect(ui).not.toContain("event.key==='Delete'");expect(ui).not.toContain("event.key==='Backspace'")})
 it('criação não toca logística, shipment, physical_ml ou preparation',()=>{for(const forbidden of ['shipments','shipment_items','physical_ml','preparation_batch','post_shipment','superfrete'])expect(sql.toLowerCase()).not.toContain(forbidden)})
})
