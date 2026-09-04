import{describe,expect,it}from'vitest'
import{existsSync,readFileSync}from'node:fs'
import Papa from'papaparse'
import{computeTotals,optionalDiagnosticRows,type DaviDiagnosticRow}from'./davi-import-diagnostics'
import{parseRows,type ImportPreview,type ParsedSale}from'./importer'
// @ts-expect-error Motor ESM compartilhado com o dry-run Node.
import{analyzeDaviImport,stageDaviParsedRows}from'../../scripts/davi-import-diagnostics-lib.mjs'

const parsedRow=(overrides:Partial<ParsedSale>):ParsedSale=>({
 row:2,client:'Cliente',normalizedClient:'cliente',date:'2026-01-01',amount:100,paymentStatus:'paid',paymentMethod:'PIX',
 note:'',signature:'sig',raw:{},warnings:[],blockers:[],isImportable:true,isAccountable:true,isDuplicate:false,...overrides,
})
const preview=(rows:ParsedSale[]):ImportPreview=>({
 fileName:'planilha.csv',sheets:['CSV'],selectedSheet:'CSV',totalRows:rows.length,rows,
 valid:rows.filter(r=>r.isImportable).length,rejected:rows.filter(r=>!r.isImportable).length,
 duplicates:rows.filter(r=>r.isDuplicate).length,uniqueClients:new Set(rows.map(r=>r.normalizedClient)).size,
 revenue:0,importedValue:rows.filter(r=>r.amount!==null&&r.amount>=0).reduce((sum,r)=>sum+(r.amount??0),0),
 reviewValue:0,cancelledValue:0,qualityPercent:0,
})
const diagRow=(overrides:Partial<DaviDiagnosticRow>):DaviDiagnosticRow=>({
 source_row:2,client:'Cliente',perfume:'Perfume',type:'apc',ml:10,amount:100,date:'2026-01-01',
 identity_classification:'NEW_SALE',sale_id:null,candidate_sale_ids:[],reason:'',confidence:1,action:'',
 stock_classification:null,stock_reason:'',inventory:null,proposed_changes:{},...overrides,
})
const sale=(id:string,overrides:Record<string,unknown>={})=>({
 id,amount:100,payment_status:'paid',deleted_at:null,inventory_allocation_eligible:true,
 client_name_raw:'Cliente',perfume_name_raw:'Perfume',...overrides,
})

describe('computeTotals — reconciliação planilha × CRM',()=>{
 it('soma bruta da planilha (TOTAL DA PLANILHA) exclui linhas sem valor',()=>{
  const p=preview([parsedRow({amount:1045}),parsedRow({row:3,amount:null,blockers:['Valor inválido ou ausente']}),parsedRow({row:4,amount:1104.7})])
  const totals=computeTotals(p,[],[])
  expect(totals.spreadsheet.gross_sum).toBe(2149.7)
  expect(totals.spreadsheet.total_lines).toBe(3)
  expect(totals.spreadsheet.lines_without_value).toBe(1)
 })

 it('preserva centavos exatos e formata em pt-BR',()=>{
  const p=preview([parsedRow({amount:1000.11}),parsedRow({row:3,amount:234.45})])
  const totals=computeTotals(p,[],[])
  expect(totals.spreadsheet.gross_sum).toBe(1234.56)
  const formatted=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(totals.spreadsheet.gross_sum)
  expect(formatted).toContain('R$')
  expect(formatted).toContain('1.234,56')
 })

 it('preserva o total confirmado da planilha mais recente até o último centavo',()=>{
  const totals=computeTotals(preview([parsedRow({amount:2_348_824.49})]),[diagRow({amount:2_348_824.49,identity_classification:'NEW_SALE'})],[])
  expect(totals.spreadsheet.gross_sum).toBe(2_348_824.49)
 })

 it('quebra por status inclui canceladas; soma excluindo canceladas as exclui',()=>{
  const p=preview([parsedRow({amount:1045,paymentStatus:'cancelled'}),parsedRow({row:3,amount:200,paymentStatus:'paid'}),parsedRow({row:4,amount:50,paymentStatus:'pending'})])
  const totals=computeTotals(p,[],[])
  expect(totals.spreadsheet.by_status.cancelled).toEqual({count:1,sum:1045})
  expect(totals.spreadsheet.by_status.paid).toEqual({count:1,sum:200})
  expect(totals.spreadsheet.by_status.pending).toEqual({count:1,sum:50})
  expect(totals.spreadsheet.sum_excluding_cancelled).toBe(250)
  expect(totals.spreadsheet.gross_sum).toBe(1295)
 })

 it('linhas com valor negativo contam como inválidas, não entram na soma bruta',()=>{
  const p=preview([parsedRow({amount:100}),parsedRow({row:3,amount:-50,blockers:['Valor inválido ou ausente'],isImportable:false})])
  const totals=computeTotals(p,[],[])
  expect(totals.spreadsheet.lines_invalid_value).toBe(1)
  expect(totals.spreadsheet.gross_sum).toBe(100)
 })

 it('total correspondente usa o valor real do CRM e a diferença fecha matematicamente por categoria',()=>{
  const p=preview([
   parsedRow({row:2,amount:100}),
   parsedRow({row:3,amount:150}),
   parsedRow({row:4,amount:80}),
   parsedRow({row:5,amount:60}),
   parsedRow({row:6,amount:null,blockers:['Cliente ausente'],isImportable:false}),
  ])
  const rows=[
   diagRow({source_row:2,amount:100,identity_classification:'EXACT_EXISTING',sale_id:'s1'}),
   diagRow({source_row:3,amount:150,identity_classification:'CONFLICT',sale_id:'s2',reason:'Mesmo cliente + perfume + tipo + data, mas valor diverge.',
    existing_matches:[{sale_id:'s2',client_id:'c1',client:'Cliente',perfume_id:'p1',perfume:'Perfume',date:'2026-01-01',type:'apc',ml:10,amount:140}]}),
   diagRow({source_row:4,amount:80,identity_classification:'NEW_SALE'}),
   diagRow({source_row:5,amount:60,identity_classification:'PROBABLE_DUPLICATE'}),
   diagRow({source_row:6,amount:null,identity_classification:'INVALID',reason:'Dados obrigatórios ausentes ou inconsistentes.'}),
  ]
  const sales=[sale('s1',{amount:100}),sale('s2',{amount:140})]
  const totals=computeTotals(p,rows,sales)
  expect(totals.spreadsheet.gross_sum).toBe(390)
  expect(totals.crm.corresponding).toEqual({count:2,sum:240})
  expect(totals.differences.spreadsheet_vs_corresponding).toBe(150)
  expect(totals.categories.MATCHED_SAME_AMOUNT).toEqual({count:1,spreadsheet_sum:100,crm_count:1,crm_sum:100,difference:0})
  expect(totals.categories.MATCHED_DIFFERENT_AMOUNT).toEqual({count:1,spreadsheet_sum:150,crm_count:1,crm_sum:140,difference:10})
  expect(totals.categories.SPREADSHEET_ONLY.spreadsheet_sum).toBe(80)
  expect(totals.categories.DUPLICATE_CANDIDATE.spreadsheet_sum).toBe(60)
  expect(totals.categories.INVALID.spreadsheet_sum).toBe(0)
  expect(totals.bridges.spreadsheet_vs_corresponding).toBe(150)
  expect(totals.reconciles.spreadsheet_vs_corresponding).toBe(true)
  expect(totals.reconciles.spreadsheet_vs_total_crm).toBe(true)
  const divergence=totals.divergences.find(row=>row.category==='MATCHED_DIFFERENT_AMOUNT')
  expect(divergence).toMatchObject({source_row:3,spreadsheet_amount:150,crm_amount:140,difference:10})
  expect(totals.divergences.some(row=>row.category==='SPREADSHEET_ONLY'&&row.source_row===4)).toBe(true)
  expect(totals.divergences.some(row=>row.category==='DUPLICATE_CANDIDATE'&&row.source_row===5)).toBe(true)
  expect(totals.divergences.some(row=>row.category==='INVALID'&&row.source_row===6)).toBe(true)
 })

 it('separa CRM_ONLY do correspondente e o inclui no fechamento contra o total geral',()=>{
  const p=preview([parsedRow({row:2,amount:100})])
  const rows=[diagRow({source_row:2,amount:100,identity_classification:'EXACT_EXISTING',sale_id:'s1'})]
  const sales=[sale('s1',{amount:100}),sale('s2',{amount:500,client_name_raw:'Outro Cliente'})]
  const totals=computeTotals(p,rows,sales)
  expect(totals.crm.crm_only).toEqual({count:1,sum:500})
  expect(totals.differences.spreadsheet_vs_corresponding).toBe(0)
  expect(totals.differences.spreadsheet_vs_total_crm).toBe(-500)
  expect(totals.bridges.spreadsheet_vs_total_crm).toBe(-500)
  expect(totals.reconciles.spreadsheet_vs_total_crm).toBe(true)
  expect(totals.divergences.some(row=>row.category==='CRM_ONLY'&&row.sale_id==='s2')).toBe(true)
 })

 it('não promove candidato duplicado a match e contabiliza cada venda candidata do CRM uma única vez',()=>{
  const p=preview([parsedRow({row:2,amount:100}),parsedRow({row:3,amount:60})])
  const candidate={sale_id:'s2',client_id:'c1',client:'Cliente',perfume_id:'p1',perfume:'Perfume',date:'2026-01-01',type:'apc',ml:10,amount:60}
  const rows=[diagRow({source_row:2,amount:100,identity_classification:'EXACT_EXISTING',sale_id:'s1',candidate_sale_ids:['s1']}),diagRow({source_row:3,amount:60,identity_classification:'PROBABLE_DUPLICATE',candidate_sale_ids:['s2'],existing_matches:[candidate]})]
  const totals=computeTotals(p,rows,[sale('s1'),sale('s2',{amount:60})])
  expect(totals.crm.corresponding).toEqual({count:1,sum:100})
  expect(totals.crm.duplicate_candidates).toEqual({count:1,sum:60})
  expect(totals.categories.DUPLICATE_CANDIDATE).toEqual({count:1,spreadsheet_sum:60,crm_count:1,crm_sum:60,difference:0})
  expect(totals.differences.spreadsheet_vs_total_crm).toBe(0)
 })

 it('overview do CRM separa geral, paga, pendente, cancelada, excluída (deleted_at) e histórica/inelegível — nunca confunde com o total conciliado',()=>{
  const sales=[
   sale('s1',{payment_status:'paid'}),
   sale('s2',{payment_status:'pending',amount:50}),
   sale('s3',{payment_status:'cancelled',amount:30}),
   sale('s4',{deleted_at:'2026-01-01T00:00:00Z',amount:999}),
   sale('s5',{inventory_allocation_eligible:false,payment_status:'paid',amount:20}),
   sale('s6',{payment_status:'unknown',amount:5}),
  ]
  const totals=computeTotals(preview([]),[],sales)
  expect(totals.crm.overview.total_general).toEqual({count:5,sum:205})
  expect(totals.crm.overview.paid).toEqual({count:2,sum:120})
  expect(totals.crm.overview.pending).toEqual({count:1,sum:50})
  expect(totals.crm.overview.cancelled).toEqual({count:1,sum:30})
  expect(totals.crm.overview.excluded_deleted).toEqual({count:1,sum:999})
  expect(totals.crm.overview.historical_ineligible).toEqual({count:1,sum:20})
  expect(totals.crm.overview.other_status).toEqual({count:1,sum:5})
  expect(totals.crm.corresponding).toEqual({count:0,sum:0})
 })

 it('continua o diagnóstico quando preparation_batches está indisponível e preserva o erro real',async()=>{
  const warning={table:'preparation_batches',code:'42703',message:'column preparation_batches.updated_at does not exist',details:'missing column',hint:'remove updated_at'}
  const result=await optionalDiagnosticRows('preparation_batches',async()=>{throw new Error('Falha opcional',{cause:warning})})
  expect(result.rows).toEqual([])
  expect(result.warning).toEqual(warning)
 })

 it('lê preparation_batches quando disponível sem gerar aviso',async()=>{
  const rows=[{id:'batch-1',organization_id:'org-1',status:'draft'}]
  await expect(optionalDiagnosticRows('preparation_batches',async()=>rows)).resolves.toEqual({rows,warning:null})
 })

 const realSnapshot='private_data/supabase-snapshot-2026-09-04T17-22-25-363Z.json'
 it.skipIf(!existsSync(realSnapshot))('fecha a planilha real contra o snapshot atual até o último centavo',()=>{
  const file='_reference/ruah-import/PLANILHA DAVI - ULTIMAS VENDAS.csv'
  const p=parseRows(file,['CSV'],'CSV',Papa.parse<unknown[]>(readFileSync(file,'utf8'),{skipEmptyLines:true}).data)
  const snapshot=JSON.parse(readFileSync(realSnapshot,'utf8'))
  snapshot.organization_id=[...new Set(snapshot.tables.sales.map((sale:{organization_id:string})=>sale.organization_id))][0]
  const analysis=analyzeDaviImport({staging:stageDaviParsedRows(p.rows,snapshot),snapshot})
  const totals=computeTotals(p,analysis.rows,snapshot.tables.sales)
  expect(totals.spreadsheet.gross_sum).toBe(2_348_824.49)
  expect(totals.crm.corresponding).toEqual({count:8575,sum:2_336_495.19})
  expect(totals.crm.overview.total_general).toEqual({count:8961,sum:2_418_358.19})
  expect(totals.differences).toEqual({spreadsheet_vs_corresponding:12_329.30,spreadsheet_vs_total_crm:-69_533.70})
  expect(totals.categories).toMatchObject({
   MATCHED_SAME_AMOUNT:{count:8573,spreadsheet_sum:2_336_219.09,crm_count:8573,crm_sum:2_336_219.09,difference:0},
   MATCHED_DIFFERENT_AMOUNT:{count:2,spreadsheet_sum:243.40,crm_count:2,crm_sum:276.10,difference:-32.70},
   SPREADSHEET_ONLY:{count:16,spreadsheet_sum:4_974.50,crm_count:0,crm_sum:0,difference:4_974.50},
   DUPLICATE_CANDIDATE:{count:43,spreadsheet_sum:6_255.80,crm_count:40,crm_sum:4_110.40,difference:2_145.40},
   INVALID:{count:13,spreadsheet_sum:1_131.70,crm_count:0,crm_sum:0,difference:1_131.70},
   CRM_ONLY:{count:346,spreadsheet_sum:0,crm_count:346,crm_sum:77_752.60,difference:-77_752.60},
  })
  expect(totals.bridges).toEqual(totals.differences)
  expect(totals.reconciles).toEqual({spreadsheet_vs_corresponding:true,spreadsheet_vs_total_crm:true})
 })
})
