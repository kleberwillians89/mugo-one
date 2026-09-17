import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const page=readFileSync(new URL('../legacy/operations/pages/FaltaSplitarPage.tsx',import.meta.url),'utf8')
const print=readFileSync(new URL('../legacy/operations/pages/SplitsDoDiaPrintPage.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('Fila do Gabriel por pessoa',()=>{
  it('abre por pessoa e mantém a visão por perfume disponível',()=>{
    expect(page).toContain("useState<'people'|'perfumes'>('people')")
    expect(page).toContain('POR PESSOA')
    expect(page).toContain('POR PERFUME')
  })
  it('carrega toda a paginação e permite imprimir lista ou cliente',()=>{
    expect(records).toContain('fetchAllSplitStatusItems')
    expect(records).toContain('if(rows.length>=result.total')
    expect(page).toContain('IMPRIMIR LISTA POR PESSOA')
    expect(page).toContain('IMPRIMIR ESTA PESSOA')
  })
  it('impressão agrupa cliente e identifica pendente e separado',()=>{
    expect(print).toContain('groupSplitItemsByClient')
    expect(print).toContain("item.split_status==='split'?'SEPARADO':'A SEPARAR'")
    expect(print).toContain('group.client_name')
  })
})
