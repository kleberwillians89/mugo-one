import fs from'node:fs'
import{describe,expect,it}from'vitest'
import{safeDaviRows,type DaviDiagnosticReport}from'./davi-import-diagnostics'

describe('Davi import diagnostics UI gate',()=>{
 it('envia ao apply apenas venda nova ou atualização efetiva com estoque aprovado',()=>{
    const base={source_row:1,client:'Cliente',perfume:'Perfume',type:'split',ml:5,amount:50,date:'2026-09-01',sale_id:null,candidate_sale_ids:[],reason:'',confidence:1,action:'',stock_reason:'',inventory:null,proposed_changes:{},organization_id:'00000000-0000-4000-8000-000000000001',source_signature:'sig-1',payment_status:'pending'}
  const report={rows:[
     {...base,identity_classification:'NEW_SALE',stock_classification:'STOCK_OK',inventory:{inventory_item_id:'00000000-0000-4000-8000-000000000005',needed_ml:5}},
     {...base,source_row:2,identity_classification:'EXACT_EXISTING',sale_id:'00000000-0000-4000-8000-000000000002',resolved_client_id:'00000000-0000-4000-8000-000000000003',resolved_perfume_id:'00000000-0000-4000-8000-000000000004',expected_updated_at:'2026-09-04T12:00:00Z',expected_payment_status:'pending',stock_classification:'STOCK_NOT_REQUIRED',proposed_changes:{payment_method:{before:null,after:'pix'}}},
   {...base,source_row:3,identity_classification:'PROBABLE_DUPLICATE',stock_classification:null},
   {...base,source_row:4,identity_classification:'CONFLICT',stock_classification:null},
   {...base,source_row:5,identity_classification:'NEW_SALE',stock_classification:'STOCK_INSUFFICIENT'},
    ],organization_id:'00000000-0000-4000-8000-000000000001',source_sha256:'a'.repeat(64),file_name:'davi.csv',snapshot_complete:true,snapshot_signature:'sig',snapshot_created_at:'2026-09-04T12:00:00Z'}as unknown as DaviDiagnosticReport
  expect(safeDaviRows(report).map(row=>row.source_row)).toEqual([1,2])
 })
 it('mantém análise e apply como ações visivelmente separadas',()=>{
  const source=fs.readFileSync('src/components/DaviImportDiagnostics.tsx','utf8')
  expect(source).toContain('ANALISAR PLANILHA')
  expect(source).toContain('APLICAR ALTERAÇÕES SEGURAS')
  expect(source).toContain('disabled={!safe.length||applying||refreshing}')
  expect(source).toContain('onClick={()=>void applySafe()}')
  expect(source).toContain("identity_classification==='PROBABLE_DUPLICATE'")
  expect(source).toContain("identity_classification==='CONFLICT'")
 })
 it('destaca o diagnóstico atual sem upload e mantém nova planilha como ação secundária',()=>{
  const source=fs.readFileSync('src/components/DaviImportDiagnostics.tsx','utf8')
  expect(source).toContain('VERIFICAR AGORA')
  expect(source).toContain('Última verificação: {dateTime(current.created_at)}')
  expect(source).toContain('Esse relatório não altera nada')
  expect(source).toContain('ANALISAR NOVA PLANILHA')
  expect(source).toContain('Use esta opção somente quando houver uma nova versão')
  expect(source).toContain('davi-diagnostic-toggle')
  expect(source).toContain('VER DIAGNÓSTICO')
  expect(source.indexOf('VERIFICAR AGORA')).toBeLessThan(source.indexOf('ANALISAR NOVA PLANILHA'))
 })
 it('usa os formatadores compartilhados pt-BR em todas as datas do diagnóstico',()=>{
  const source=fs.readFileSync('src/components/DaviImportDiagnostics.tsx','utf8')
  const page=fs.readFileSync('src/pages/DaviExcelPage.tsx','utf8')
  const attachments=fs.readFileSync('src/components/SalePaymentAttachmentsModal.tsx','utf8')
  expect(source).toContain("import{dateTime,shortDate}from'../lib/format'")
  expect(source).toContain('shortDate(row.date)')
  expect(source).toContain('shortDate(candidate.date)')
  expect(source).toContain('displayStructuredDates(item.actual)')
  expect(source).not.toContain('toLocaleTimeString')
  expect(page).toContain("import{clientNumber,shortDate}from'../lib/format'")
  expect(page).not.toMatch(/\{date\(row\./)
  expect(attachments).toContain('dateTime(item.created_at)')
  expect(attachments).toContain('shortDate(sale.sale_date)')
 })
})
