import fs from'node:fs'
import{describe,expect,it}from'vitest'
import{safeDaviRows,type DaviDiagnosticReport}from'./davi-import-diagnostics'

describe('Davi import diagnostics UI gate',()=>{
 it('envia ao apply apenas venda nova ou atualização efetiva com estoque aprovado',()=>{
  const base={source_row:1,client:'Cliente',perfume:'Perfume',type:'split',ml:5,amount:50,date:'2026-09-01',sale_id:null,candidate_sale_ids:[],reason:'',confidence:1,action:'',stock_reason:'',inventory:null,proposed_changes:{}}
  const report={rows:[
   {...base,identity_classification:'NEW_SALE',stock_classification:'STOCK_OK'},
   {...base,source_row:2,identity_classification:'EXACT_EXISTING',stock_classification:'STOCK_NOT_REQUIRED',proposed_changes:{payment_method:{before:null,after:'pix'}}},
   {...base,source_row:3,identity_classification:'PROBABLE_DUPLICATE',stock_classification:null},
   {...base,source_row:4,identity_classification:'CONFLICT',stock_classification:null},
   {...base,source_row:5,identity_classification:'NEW_SALE',stock_classification:'STOCK_INSUFFICIENT'},
  ]}as unknown as DaviDiagnosticReport
  expect(safeDaviRows(report).map(row=>row.source_row)).toEqual([1,2])
 })
 it('mantém análise e apply como ações visivelmente separadas',()=>{
  const source=fs.readFileSync('src/components/DaviImportDiagnostics.tsx','utf8')
  expect(source).toContain('ANALISAR PLANILHA')
  expect(source).toContain('APLICAR ALTERAÇÕES SEGURAS')
  expect(source).toMatch(/button type="button" disabled title=/)
  expect(source).toContain("identity_classification==='PROBABLE_DUPLICATE'")
  expect(source).toContain("identity_classification==='CONFLICT'")
 })
})
