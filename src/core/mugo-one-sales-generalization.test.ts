import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão da FASE D ("Vendas genéricas") da sprint de
 * generalização do produto ativo — ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §5. A LISTAGEM de Vendas
 * não pode mais assumir que toda venda é um perfume/frasco/APC/SPLIT
 * de ML obrigatório. `src/lib/records.ts` (camada de dados legada) não
 * foi alterado nesta fase — só a apresentação em src/pages/SalesPage.tsx.
 * O modal "Nova venda" (src/components/RecordModals.tsx) ainda é o
 * legado e é escopo da Fase F, não desta.
 */

function readAll(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('sales generalization guard — a listagem de Vendas não expõe mais colunas/filtros de perfume', () => {
  const page = readAll('src/pages/SalesPage.tsx')

  it('não tem coluna nem filtro rotulado Perfume, Frasco, Tipo (APC/SPLIT) ou ML', () => {
    for (const label of ["label:'Perfume'", "label:'Frasco'", "<span>Perfume</span>", "<span>Frasco</span>", "<span>Tipo</span>", "<span>Volume</span>", '<option>APC</option>', '<option>SPLIT</option>']) {
      expect(page, `SalesPage.tsx não pode conter ${label}`).not.toContain(label)
    }
  })

  it('não oferece "Perfume A–Z" como opção de ordenação nem como default', () => {
    expect(page).not.toContain('Perfume A–Z')
    expect(page).not.toContain("sort:'perfume_name_raw_asc'")
  })

  it('a tabela principal usa as colunas genéricas do briefing (Itens, Quantidade) no lugar de Perfume/Frasco/Tipo/ML', () => {
    expect(page).toContain("{key:'items',label:'Itens'")
    expect(page).toContain("{key:'quantity',label:'Quantidade'")
  })

  it('exportação de CSV usa nome de arquivo genérico, sem "ruah"', () => {
    expect(page.toLowerCase()).not.toContain('vendas-ruah')
  })

  it('nenhum resíduo morto do antigo modal inline de detalhes (SaleDetails) permanece — Venda 360 é a única superfície de detalhe, via /vendas/:id', () => {
    expect(page).not.toContain('function SaleDetails(')
    expect(page).not.toContain('VENDA E LOGÍSTICA')
  })
})
