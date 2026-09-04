import{describe,expect,it}from'vitest'
import{reconcileOfficialClients}from'../../scripts/official-client-reconciliation.mjs'

const source=(overrides={})=>({source_row:2,name:'Ana Silva',cpf:'52998224725',phone:'11987654321',postal_code:'01001000',address_line:'Rua A',address_number:'10',complement:'',district:'Centro',city:'São Paulo',state:'SP',...overrides})
const crm=(overrides={})=>({id:'crm-1',name:'ANA SILVA',cpf:null,phone:null,postal_code:null,address_line:null,address_number:null,complement:null,district:null,city:null,state:null,deleted_at:null,merged_into_id:null,...overrides})

describe('official RUAH client reconciliation dry-run',()=>{
 it('matches exact CPF before phone and name',()=>{
  const report=reconcileOfficialClients([source()], [crm({cpf:'52998224725'})])
  expect(report.counts.EXACT_CPF).toBe(1)
  expect(report.rows[0].match_method).toBe('EXACT_CPF')
 })
 it('matches exact phone when CPF is unavailable',()=>{
  const report=reconcileOfficialClients([source({cpf:'',phone:'+351 912345678'})], [crm({name:'Outra Pessoa',phone:'+351 912345678'})])
  expect(report.counts.EXACT_PHONE).toBe(1)
 })
 it('uses unique exact name and sends duplicate names to review',()=>{
  expect(reconcileOfficialClients([source({cpf:'',phone:''})],[crm()]).counts.EXACT_UNIQUE_NAME).toBe(1)
  expect(reconcileOfficialClients([source({cpf:'',phone:''})],[crm(),crm({id:'crm-2'})]).counts.AMBIGUOUS).toBe(1)
 })
 it('does not auto-apply CPF conflicts, invalid source data, or fuzzy names',()=>{
    const conflict=reconcileOfficialClients([source({phone:'11999999999'})],[crm({phone:'11999999999',cpf:'11144477735'})])
  expect(conflict.counts.CONFLICT+conflict.counts.INVALID_SOURCE_DATA).toBe(1)
  const invalid=reconcileOfficialClients([source({cpf:'123',postal_code:'12'})],[crm({name:'Outra Pessoa'})])
  expect(invalid.counts.INVALID_SOURCE_DATA).toBe(1)
  const fuzzy=reconcileOfficialClients([source({name:'Ana Silv',cpf:'',phone:''})],[crm()])
  expect(fuzzy.counts.NEW_CLIENT).toBe(1)
 })
 it('preserves empty CRM fields and never reassigns sales',()=>{
  const report=reconcileOfficialClients([source()],[crm()])
  expect(report.proposed_update_count).toBe(1)
  expect(report.client_id_reassignments).toBe(0)
  expect(report.sales_changed).toBe(0)
  expect(report.rows[0].proposed_changes).toHaveProperty('cpf')
 })
})
