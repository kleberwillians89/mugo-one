import{describe,expect,it}from'vitest'
import{buildSafeManifest,reconcileEmilyClients}from'../../scripts/emily-client-reconciliation.mjs'

const source=(overrides={})=>({source_row:2,name:'Ana Silva',cpf:'52998224725',phone:'11987654321',email:'ana@example.com',postal_code:'01001000',address_line:'Rua A',address_number:'10',complement:'',district:'Centro',city:'São Paulo',state:'SP',...overrides})
const crm=(overrides={})=>({id:'crm-1',name:'ANA SILVA',cpf:null,phone:null,whatsapp_phone:null,email:null,postal_code:null,address_line:null,address_number:null,complement:null,district:null,city:null,state:null,deleted_at:null,merged_into_id:null,updated_at:'2026-01-01T00:00:00Z',...overrides})

describe('cruzamento cadastral com a planilha da Emily',()=>{
 it('prioriza CPF > e-mail > telefone > nome único',()=>{
  expect(reconcileEmilyClients([source()],[crm({cpf:'52998224725',email:'outro@x.com'})]).counts.EXACT_CPF).toBe(1)
  expect(reconcileEmilyClients([source({cpf:''})],[crm({email:'ana@example.com'})]).counts.EXACT_EMAIL).toBe(1)
  expect(reconcileEmilyClients([source({cpf:'',email:''})],[crm({phone:'11987654321'})]).counts.EXACT_PHONE).toBe(1)
  expect(reconcileEmilyClients([source({cpf:'',email:'',phone:''})],[crm()]).counts.EXACT_UNIQUE_NAME).toBe(1)
 })
 it('nunca casa fuzzy: nome duplicado nos dois lados vira AMBIGUOUS, nunca mescla',()=>{
  const report=reconcileEmilyClients([source({cpf:'',email:'',phone:''})],[crm(),crm({id:'crm-2'})])
  expect(report.counts.AMBIGUOUS).toBe(1)
  expect(report.safe_to_update).toHaveLength(0)
 })
 it('duplicidade dentro da própria planilha da Emily (mesmo CPF/e-mail/telefone em duas linhas) bloqueia as duas com AMBIGUOUS',()=>{
  const rows=[source({source_row:2,cpf:'52998224725'}),source({source_row:3,cpf:'52998224725',name:'Outra Pessoa'})]
  const report=reconcileEmilyClients(rows,[crm({cpf:'52998224725'}),crm({id:'crm-2',name:'Outra Pessoa'})])
  expect(report.counts.AMBIGUOUS).toBe(2)
 })
 it('CPF diferente é CONFLICT e nunca é aplicado automaticamente',()=>{
  const report=reconcileEmilyClients([source({phone:''})],[crm({phone:'11987654321',cpf:'11144477735'})])
  expect(report.counts.CONFLICT).toBe(1)
  expect(report.safe_to_update).toHaveLength(0)
 })
 it('linha com CPF/telefone/CEP estruturalmente inválido vira INVALID_SOURCE_DATA e nunca é segura',()=>{
  const invalidCpf=reconcileEmilyClients([source({cpf:'12345678900',phone:'',email:''})],[crm({name:'Outra Pessoa'})])
  expect(invalidCpf.counts.INVALID_SOURCE_DATA).toBe(1)
  const invalidCep=reconcileEmilyClients([source({postal_code:'123'})],[crm({cpf:'52998224725'})])
  expect(invalidCep.counts.INVALID_SOURCE_DATA).toBe(1)
  expect(invalidCep.safe_to_update).toHaveLength(0)
 })
 it('preenche campos vazios do CRM em qualquer nível de match e nunca apaga por célula vazia na Emily',()=>{
  const report=reconcileEmilyClients([source()],[crm({cpf:'52998224725'})])
  expect(report.safe_to_update).toHaveLength(1)
  expect(report.safe_to_update[0].proposed_changes).toHaveProperty('email')
  expect(report.safe_to_update[0].proposed_changes).toHaveProperty('address_line')
  const sourceComEmailVazio=source({email:''})
  const semApagar=reconcileEmilyClients([sourceComEmailVazio],[crm({cpf:'52998224725',email:'existente@crm.com'})])
  expect(semApagar.safe_to_update[0]?.proposed_changes.email).toBeUndefined()
 })
 it('telefone/e-mail diferentes só entram como alteração segura quando a linha foi identificada por CPF exato',()=>{
  const viaCpf=reconcileEmilyClients([source({phone:'11999999999'})],[crm({cpf:'52998224725',phone:'11987654321'})])
  expect(viaCpf.safe_to_update[0]?.proposed_changes.phone).toEqual({before:'5511987654321',after:'5511999999999'})
  const crmCompletoExcetoTelefone=crm({email:'ana@example.com',address_line:'Rua A',address_number:'10',district:'Centro',city:'São Paulo',state:'SP',postal_code:'01001000',phone:'11912340000'})
  const viaNome=reconcileEmilyClients([source({cpf:'',email:'ana@example.com',phone:'11999999999'})],[crmCompletoExcetoTelefone])
  expect(viaNome.rows[0].match_method).toBe('EXACT_EMAIL')
  expect(viaNome.rows[0].proposed_changes.phone).toBeUndefined()
  expect(viaNome.safe_to_update).toHaveLength(0)
 })
 it('endereço diferente só é sobrescrito com match forte e dados da Emily completos; nunca com match só por nome',()=>{
  const forte=reconcileEmilyClients([source()],[crm({cpf:'52998224725',address_line:'Rua Antiga',address_number:'1',district:'Bairro X',city:'Outra Cidade',state:'RJ',postal_code:'99999999'})])
  expect(forte.safe_to_update[0]?.proposed_changes.address_line).toEqual({before:'Rua Antiga',after:'Rua A'})
  const fraco=reconcileEmilyClients([source({cpf:'',email:'',phone:''})],[crm({address_line:'Rua Antiga',address_number:'1',district:'Bairro X',city:'Outra Cidade',state:'RJ',postal_code:'99999999'})])
  expect(fraco.rows[0].proposed_changes.address_line).toBeUndefined()
 })
 it('endereço incompleto na Emily nunca sobrescreve endereço existente mesmo com match forte',()=>{
  const report=reconcileEmilyClients([source({address_number:''})],[crm({cpf:'52998224725',address_line:'Rua Antiga',address_number:'1',district:'Bairro X',city:'Outra Cidade',state:'RJ',postal_code:'99999999'})])
  expect(report.rows[0].proposed_changes.address_line).toBeUndefined()
 })
 it('nunca reatribui client_id de vendas nem cria/mescla clientes',()=>{
  const report=reconcileEmilyClients([source()],[crm({cpf:'52998224725'})])
  expect(report.client_id_reassignments).toBe(0)
  expect(report.sales_changed).toBe(0)
 })
 it('manifesto SAFE_TO_UPDATE exclui NEW_CLIENT/AMBIGUOUS/CONFLICT/INVALID e é determinístico por client_id',()=>{
  const rows=[
   source({source_row:2,name:'Zeta',cpf:'52998224725',phone:'11911110000',email:'zeta@example.com'}),
   source({source_row:3,name:'Alpha',cpf:'11144477735',phone:'11922220000',email:'alpha@example.com'}),
   source({source_row:4,name:'Novo Cliente',cpf:'',email:'',phone:''}),
  ]
  const crmRows=[crm({id:'c-zeta',name:'Zeta',cpf:'52998224725'}),crm({id:'c-alpha',name:'Alpha',cpf:'11144477735'})]
  const report=reconcileEmilyClients(rows,crmRows)
  expect(report.counts.NEW_CLIENT).toBe(1)
  const manifest=buildSafeManifest(report,{source_file_sha256:'abc'})
  expect(manifest.entries.map(entry=>entry.client_id)).toEqual(['c-alpha','c-zeta'])
  for(const entry of manifest.entries){
   expect(entry).toHaveProperty('expected_updated_at')
   expect(entry).toHaveProperty('before')
   expect(entry).toHaveProperty('after')
   expect(entry).toHaveProperty('match_method')
   expect(entry).toHaveProperty('source_row')
  }
  expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(manifest.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  const reversedManifest=buildSafeManifest({...report,safe_to_update:[...report.safe_to_update].reverse()},{source_file_sha256:'abc'})
  expect(reversedManifest.sha256).toBe(manifest.sha256)
  expect(reversedManifest.fingerprint).toBe(manifest.fingerprint)
 })
})
