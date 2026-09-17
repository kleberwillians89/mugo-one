import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608230001_davi_excel_quick_client_optional_fields.sql','utf8')
const original=readFileSync('supabase/migrations/202608220008_davi_excel_quick_client.sql','utf8')
const modal=readFileSync('src/legacy/spreadsheet/DaviQuickClientModal.tsx','utf8')
const grid=readFileSync('src/legacy/spreadsheet/DaviExcelNewRows.tsx','utf8')

describe('hotfix da RPC de cliente rápido do Davi Excel',()=>{
  it('não altera a migration 220008 e substitui a mesma assinatura em migration nova',()=>{
    expect(original).toContain('create or replace function public.davi_excel_create_client(')
    expect(migration).toContain('create or replace function public.davi_excel_create_client(')
    expect(migration).toContain('p_organization_id uuid')
    expect(migration).toContain('p_payload jsonb')
  })

  it.each([
    ['telefone','v_phone'],
    ['CPF','v_cpf'],
    ['e-mail','v_email'],
  ])('normaliza %s vazio para NULL sem referência ambígua',(_,variable)=>{
    expect(migration).toContain(`${variable} text := nullif(`)
    expect(migration).toContain(`c.normalized_${variable==='v_cpf'?'cpf':variable==='v_email'?'email':'phone'} = ${variable}`)
  })

  it('qualifica colunas e usa nomes próprios para todas as variáveis sensíveis',()=>{
    for(const variable of ['v_name','v_phone','v_cpf','v_email','v_uid','v_normalized_name'])expect(migration).toContain(variable)
    for(const column of ['c.organization_id','c.name','c.normalized_name','c.normalized_cpf','c.normalized_email','c.normalized_phone','c.normalized_whatsapp'])expect(migration).toContain(column)
    expect(migration).not.toMatch(/\bwhen cpf\b|\bwhen email\b|\bwhen phone\b|\bwhere organization_id\b/)
  })

  it('aceita só nome e mantém telefone, CPF e e-mail opcionais no frontend',()=>{
    expect(modal).toContain("if(!form.name.trim())return setError('Informe o nome da cliente.')")
    expect(modal).toContain("form.phone&&")
    expect(modal).toContain("form.cpf&&")
    expect(modal).toContain("form.email&&")
    expect(modal).toContain('<span>NOME *</span>')
    expect(modal).not.toContain('<span>TELEFONE *</span>')
    expect(modal).not.toContain('<span>CPF *</span>')
    expect(modal).not.toContain('<span>E-MAIL *</span>')
  })

  it('rejeita nome vazio e retorna ID real do registro criado',()=>{
    expect(migration).toContain("raise exception 'client_name_required'")
    expect(migration).toContain("jsonb_build_object('id', v_created.id, 'name', v_created.name)")
  })

  it('preserva tenant, permissão e autoria operacional',()=>{
    expect(migration).toContain("has_org_permission(p_organization_id, 'clients.create')")
    expect(migration).toContain('c.organization_id = p_organization_id')
    expect(migration).toContain("'davi_excel', 'davi_excel'")
    expect(migration).toContain('v_phone, v_phone, v_email, v_cpf, v_uid')
  })

  it('auto-seleciona o cliente real e conserva o restante do rascunho',()=>{
    expect(grid).toContain('client:option,clientText:client.name')
    expect(grid).toContain('setDrafts(apply)')
    expect(grid).toContain('setQuickClient(null)')
    expect(grid).not.toContain('setDrafts([fresh()])')
  })

  it('não cria autenticação, Minha RUAH, venda, estoque ou logística',()=>{
    for(const forbidden of ['auth.users','client_accounts','insert into public.sales','shipments','inventory','post_shipment'])expect(migration.toLowerCase()).not.toContain(forbidden)
  })
})
