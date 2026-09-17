import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page=readFileSync(new URL('../pages/SalesPage.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('Vendas — ordem padrão',()=>{
  it('abre e limpa os filtros mantendo a mesma ordem padrão determinística (Fase D da generalização: deixou de ser Perfume A–Z, ver docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md)',()=>{
    expect(page).toContain("useState<SaleFilters>({period,sort:'sale_date_desc'})")
    expect(page).toContain("setFilters({period,sort:'sale_date_desc'})")
  })

  it('a ordenação por item (antigo default) continua disponível no servidor, estável por empate, mesmo não sendo mais o default da UI — records.ts não foi alterado nesta fase',()=>{
    expect(records).toContain("const sort=filters.sort??'perfume_name_raw_asc'")
    expect(records).toContain("if(column==='perfume_name_raw')query=query.order('sale_date',{ascending:false,nullsFirst:false}).order('client_name_raw',{ascending:true,nullsFirst:false})")
    expect(records.indexOf("query=query.order(column")).toBeLessThan(records.indexOf('query=query.range('))
  })
})
