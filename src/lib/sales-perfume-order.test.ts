import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page=readFileSync(new URL('../pages/SalesPage.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('Vendas — ordem por perfume',()=>{
  it('abre e limpa os filtros mantendo Perfume A–Z como ordem padrão',()=>{
    expect(page).toContain("useState<SaleFilters>({period,sort:'perfume_name_raw_asc'})")
    expect(page).toContain("setFilters({period,sort:'perfume_name_raw_asc'})")
  })

  it('ordena no servidor antes da paginação e estabiliza empates por data e cliente',()=>{
    expect(records).toContain("const sort=filters.sort??'perfume_name_raw_asc'")
    expect(records).toContain("if(column==='perfume_name_raw')query=query.order('sale_date',{ascending:false,nullsFirst:false}).order('client_name_raw',{ascending:true,nullsFirst:false})")
    expect(records.indexOf("query=query.order(column")).toBeLessThan(records.indexOf('query=query.range('))
  })
})
