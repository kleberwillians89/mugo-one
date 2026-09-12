import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202609120006_paid_split_and_apc_separation.sql','utf8')
const page=readFileSync('src/pages/FaltaSplitarPage.tsx','utf8')

describe('fila paga de separação do Gabriel',()=>{
  it('só lista e permite concluir vendas pagas',()=>{
    expect((migration.match(/payment_status='paid'/g)??[]).length).toBeGreaterThanOrEqual(5)
    expect(migration).toContain("sale_not_paid_for_separation")
  })
  it('mantém APC separado dos campos históricos de SPLIT',()=>{
    for(const field of['apc_separation_status','apc_separated_at','apc_separated_by'])expect(migration).toContain(field)
    expect(migration).toContain("sale_type in('SPLIT','APC')")
  })
  it('mostra APC e SPLIT de forma explícita para o Gabriel',()=>{
    for(const label of['SPLITS A SEPARAR','APC A SEPARAR','Fila do Gabriel','A SEPARAR','SEPARADO'])expect(page).toContain(label)
    expect(page).toContain("sale_type:saleType")
  })
})
