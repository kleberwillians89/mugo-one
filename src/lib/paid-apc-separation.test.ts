import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202609120006_paid_split_and_apc_separation.sql','utf8')
const unlock=readFileSync('supabase/migrations/202609120007_unlock_split_queue_before_payment.sql','utf8')
const page=readFileSync('src/pages/FaltaSplitarPage.tsx','utf8')

describe('fila de separação do Gabriel',()=>{
  it('202609120006 introduziu a fila exigindo venda paga (comportamento histórico, substituído por 202609120007)',()=>{
    expect((migration.match(/payment_status='paid'/g)??[]).length).toBeGreaterThanOrEqual(5)
    expect(migration).toContain("sale_not_paid_for_separation")
  })
  it('202609120007 libera a fila e as ações de separação sem exigir pagamento confirmado',()=>{
    for(const fn of['set_sale_split_status','set_sale_split_status_bulk','complete_sale_splits_for_filter','sale_split_status_cards','sale_split_status_perfume_summary','sale_split_status_list'])expect(unlock).toContain(`function public.${fn}`)
    expect(unlock).not.toContain("payment_status='paid'")
    expect(unlock).not.toContain('sale_not_paid_for_separation')
    expect(unlock).toContain("sale_type in('SPLIT','APC')")
  })
  it('mantém APC separado dos campos históricos de SPLIT',()=>{
    for(const field of['apc_separation_status','apc_separated_at','apc_separated_by'])expect(migration).toContain(field)
    expect(migration).toContain("sale_type in('SPLIT','APC')")
  })
  it('mostra APC e SPLIT de forma explícita para o Gabriel, mesmo antes do pagamento',()=>{
    for(const label of['SPLITS A SEPARAR','APC A SEPARAR','Fila do Gabriel','A SEPARAR','SEPARADO'])expect(page).toContain(label)
    expect(page).toContain("sale_type:group.sale_type,bottle:group.bottle_identifier")
    expect(page).toContain("group.perfume_name} · {group.bottle_identifier")
    expect(page).not.toContain('somente depois que o Davi marca a venda como paga')
  })
})
