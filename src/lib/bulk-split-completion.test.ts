import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const page=readFileSync('src/pages/FaltaSplitarPage.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const migration=readFileSync('supabase/migrations/202609050008_reset_deliveries_and_atomic_bulk_split.sql','utf8')

describe('conclusão geral de splits',()=>{
  it('aciona o backend para todo o filtro e informa a quantidade real',()=>{
    expect(page).toContain('completeSplitStatusForFilter(effectiveFilters)')
    expect(page).toContain('${result.updated_count} vendas marcadas como splitadas.')
    expect(page).toContain('não apenas os itens abertos ou visíveis')
    expect(records).toContain("rpc('complete_sale_splits_for_filter'")
  })

  it('é uma ação somente de conclusão, nunca um toggle destrutivo global',()=>{
    expect(page).not.toContain("runBulk('not_split')")
    expect(migration).toContain("if p_status<>'split' then raise exception 'bulk_split_undo_not_allowed'")
    expect(migration).toContain("sale.split_completed_at is null")
    expect(migration).toContain("sale.sale_type='SPLIT'")
  })

  it('executa um único update transacional, preserva APC e não sobrescreve timestamp já existente',()=>{
    const filtered=migration.slice(migration.indexOf('create or replace function public.complete_sale_splits_for_filter'))
    expect(filtered).toContain("sale.sale_type='SPLIT'")
    expect(filtered).toContain('sale.split_completed_at is null')
    expect(filtered).toContain("split_completed_at=current_date")
    expect(filtered).not.toContain("sale_type='APC'")
    expect(filtered).not.toContain('exception when others')
  })

  it('grava auditoria por venda e o evento bulk sem dados pessoais',()=>{
    expect(migration).toContain('insert into public.sale_split_status_audit')
    expect(migration).toContain("'bulk_split_completed'")
    expect(migration).toContain("'sale_ids',jsonb_agg(sale.id order by sale.id)")
    expect(migration).not.toContain("'client_name'")
  })

  it('não exibe sucesso antes da confirmação do Supabase',()=>{
    const action=page.slice(page.indexOf('const completeCurrentFilter='),page.indexOf('const openPrint='))
    expect(action.indexOf('await completeSplitStatusForFilter(effectiveFilters)')).toBeLessThan(action.indexOf('vendas marcadas como splitadas.'))
    expect(action).toContain("push(error instanceof Error?error.message:'Falha ao marcar os splits do filtro.'")
  })
})
