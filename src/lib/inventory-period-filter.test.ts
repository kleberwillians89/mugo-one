import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const page=readFileSync(new URL('../pages/InventoryPage.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const assistant=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')

describe('Estoque — filtro real por data e resolução de perfume',()=>{
  it('busca os perfumes pelas vendas dentro das duas datas selecionadas',()=>{
    expect(records).toContain('fetchInventorySaleBottleIdentities(period:PeriodValue)')
    expect(records).toContain(".gte('sale_date',period.start).lte('sale_date',period.end)")
    expect(page).toContain('fetchInventorySaleBottleIdentities(period)')
    expect(page).toContain('periodItemIds.has(row.item_id)')
  })

  it('usa somente os perfumes do período nos cards, métricas e exportação',()=>{
    expect(page).toContain('const periodOperational=operational.filter')
    expect(page).toContain('periodOperational.reduce')
    expect(page).toContain("exportCsv('estoque.csv',periodOperational")
  })

  it('sempre oferece resolução quando o perfume não foi vinculado, inclusive em revisão',()=>{
    expect(assistant).toContain("!preview.perfume_id&&<button")
    expect(assistant).toContain('RESOLVER OU CADASTRAR PERFUME')
  })

  it('avisa divergência da tabela publicada sem bloquear volumes não vendidos',()=>{
    const blockers=assistant.slice(assistant.indexOf('const blockers='),assistant.indexOf('const perfumePendingCount='))
    expect(blockers).not.toContain("pricing_consistent===false)list.push")
    expect(assistant).toContain("preview.pricing_consistent===false")
  })
})
