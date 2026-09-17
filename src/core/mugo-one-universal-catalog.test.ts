import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão da sprint "Catálogo Universal + Sale Items"
 * (Fase E/F) — ver docs/SALES_CATALOG_MIGRATION_PLAN.md. Cobre as
 * regras estruturais checáveis por análise de código-fonte; os testes
 * de isolamento multi-tenant/atomicidade real ficam no smoke test ao
 * vivo (item 34 do briefing), já que dependem de RLS/RPC no banco.
 */

function readAll(path: string): string {
  return readFileSync(path, 'utf8')
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

describe('universal catalog guard — Nova Venda ativa nunca abre o formulário legado de perfume', () => {
  it('SalesPage e GenericPage abrem NewSaleModal, não o LegacySaleModal/SaleModal antigo', () => {
    const salesPage = readAll('src/pages/SalesPage.tsx')
    const genericPage = readAll('src/pages/GenericPage.tsx')
    for (const source of [salesPage, genericPage]) {
      expect(source).toContain('NewSaleModal')
      expect(source).not.toContain('LegacySaleModal')
      expect(source).not.toMatch(/from '\.\.\/components\/RecordModals'.*SaleModal/)
    }
  })

  it('o formulário legado continua existindo isolado em src/legacy/sales/, não apagado', () => {
    const files = listFilesRecursive('src/legacy/sales')
    expect(files.some((f) => f.endsWith('LegacySaleModal.tsx'))).toBe(true)
  })

  it('RecordModals.tsx (ativo) não exporta mais SaleModal', () => {
    const content = readAll('src/components/RecordModals.tsx')
    expect(content).not.toContain('export function SaleModal')
  })
})

describe('universal catalog guard — NewSaleModal e ProductsServicesPage não contêm termos verticais', () => {
  // sale-items.ts fica de fora deste teste de propósito: é a fronteira
  // explícita com o legado (legacySaleItemLine), igual a
  // spreadsheet-adapter.ts na Fase C — é o único lugar autorizado a ler
  // perfume_name_raw/volume_ml de uma venda antiga. Ver o teste seguinte.
  const forbidden = ['perfume', 'frasco', 'splitar', 'bottle', 'apc', 'ml_obrigatorio']
  const files = ['src/components/NewSaleModal.tsx', 'src/pages/ProductsServicesPage.tsx', 'src/lib/catalog.ts']

  it('nenhum dos arquivos novos contém perfume/frasco/split/APC/bottle', () => {
    for (const file of files) {
      const content = readAll(file).toLowerCase()
      for (const word of forbidden) {
        expect(content, `${file} não pode conter "${word}"`).not.toContain(word)
      }
    }
  })

  it('nenhuma pessoa da operação antiga aparece nesses arquivos', () => {
    for (const file of [...files, 'src/lib/sale-items.ts']) {
      expect(readAll(file)).not.toMatch(/\b(Davi|Gabriel|Emily|Ilde|Gabi)\b/)
    }
  })

  it('sale-items.ts só lê o campo legado dentro de legacySaleItemLine — nenhum outro lugar do arquivo referencia perfume/frasco', () => {
    const content = readAll('src/lib/sale-items.ts')
    const legacyFn = content.slice(content.indexOf('export function legacySaleItemLine'), content.indexOf('export async function fetchSaleItems'))
    expect(legacyFn.toLowerCase()).toContain('perfume_name_raw')
    const rest = content.replace(legacyFn, '')
    expect(rest.toLowerCase()).not.toContain('perfume')
  })
})

describe('universal catalog guard — Venda 360 nunca assume logística/estoque sem feature habilitada', () => {
  const page = readAll('src/pages/SaleDetailsPage.tsx')

  it('as seções de Custódia/Estoque e Logística são condicionadas a hasFeature', () => {
    expect(page).toContain("hasInventoryFeature&&<>")
    expect(page).toContain("hasShippingFeature&&<>")
    expect(page).toContain("useHasFeature('shipping')")
    expect(page).toContain("useHasFeature('inventory')")
  })

  it('a seção de Itens é sempre genérica (Produto/Serviço, Quantidade, Unidade) e não condicionada a feature', () => {
    const itemsSection = page.slice(page.indexOf('Divider label="Itens"'), page.indexOf('Divider label="Pagamento"'))
    expect(itemsSection).toContain('Produto/Serviço')
    expect(itemsSection).not.toContain('hasFeature')
  })

  it('o botão de confirmação de custódia não menciona a instituição legada', () => {
    expect(page.toLowerCase()).not.toContain('ruah')
  })
})

describe('universal catalog guard — menu e feature flags', () => {
  it('routing.ts expõe "Produtos" com permissão catalog.view', () => {
    const routing = readAll('src/routing.ts')
    expect(routing).toContain("'Produtos':['catalog.view']")
    expect(routing).toContain("'Produtos':'/produtos'")
  })

  it('catalog é core no featureCatalog (Vendas não existe sem catálogo)', () => {
    const catalog = readAll('src/core/features/featureCatalog.ts')
    expect(catalog).toContain("{ code: 'catalog', label: 'Catálogo', isCore: true }")
  })

  it('permissions.ts espelha catalog.view/catalog.manage (paridade com o banco já verificada por permissions-catalog.test.ts)', () => {
    const permissions = readAll('src/lib/permissions.ts')
    expect(permissions).toContain("{ code: 'catalog.view', module: 'catalog', label: 'Visualizar catálogo' }")
    expect(permissions).toContain("{ code: 'catalog.manage', module: 'catalog', label: 'Gerenciar catálogo' }")
  })
})

describe('universal catalog guard — string legada corrigida', () => {
  it('records.ts não indica mais o usuário para "Davi Excel" — a superfície ativa se chama Planilha', () => {
    const records = readAll('src/lib/records.ts')
    expect(records).not.toContain('Corrija-a no Davi Excel')
  })
})
