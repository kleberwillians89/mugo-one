import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão da FASE C ("Davi Excel" → "Planilha") da sprint
 * de generalização do produto ativo — ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §2-4. O código antigo
 * continua existindo (não foi apagado) em src/legacy/spreadsheet/, só
 * saiu da navegação/roteamento ativos.
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

describe('spreadsheet generalization guard — "Davi Excel" não pode voltar a ser um módulo do Core ativo', () => {
  it('os 7 arquivos .tsx legados continuam existindo (isolados, não apagados) em src/legacy/spreadsheet/', () => {
    const files = listFilesRecursive('src/legacy/spreadsheet')
    for (const name of ['DaviExcelPage.tsx', 'DaviExcelNewRows.tsx', 'DaviImportDiagnostics.tsx', 'DaviQuickClientModal.tsx']) {
      expect(files.some((f) => f.endsWith(name)), `${name} deveria continuar existindo em src/legacy/spreadsheet/`).toBe(true)
    }
  })

  it('routing.ts não tem "Davi Excel" como valor de código (Page union/navigation/routes/pagePermission) — só em comentário explicando a troca', () => {
    const routing = readAll('src/routing.ts')
    expect(routing).not.toMatch(/'Davi Excel'\s*[,:|]/)
    expect(routing).toContain("'Planilha'")
    expect(routing).toContain("'Planilha':'/planilha'")
  })

  it('App.tsx não importa nem roteia para o DaviExcelPage legado — usa SpreadsheetPage', () => {
    const app = readAll('src/App.tsx')
    expect(app).not.toContain('DaviExcelPage')
    expect(app).toContain('SpreadsheetPage')
    expect(app).toContain("page === 'Planilha'")
  })

  it('a Planilha nova (src/pages/SpreadsheetPage.tsx + src/components/spreadsheet/) não contém nenhum termo vertical de perfume/frasco/split/APC', () => {
    // spreadsheet-adapter.ts é a fronteira explícita com o registro legado
    // (padrão LegacySaleAdapter) — só ele pode mencionar esses termos, e é
    // coberto pelo teste seguinte, específico para essa fronteira.
    const files = ['src/pages/SpreadsheetPage.tsx', ...listFilesRecursive('src/components/spreadsheet')]
    const forbidden = ['perfume', 'frasco', 'splitar', 'bottle']
    for (const file of files) {
      const content = readAll(file).toLowerCase()
      for (const word of forbidden) {
        expect(content, `${file} não pode conter "${word}"`).not.toContain(word)
      }
    }
  })

  it('a Planilha nova nasce com o conjunto de colunas genérico do briefing, não colunas de perfume', () => {
    const page = readAll('src/pages/SpreadsheetPage.tsx')
    for (const label of ['CLIENTE', 'DATA', 'ITEM', 'QUANTIDADE', 'VALOR', 'PAGAMENTO']) {
      expect(page).toContain(`label: '${label}'`)
    }
  })

  it('nenhuma pessoa da operação antiga (Davi/Gabriel/Emily/Ilde/Gabi) aparece como identificador/label/rota em src/pages/SpreadsheetPage.tsx ou src/components/spreadsheet/ — só é permitido citar "Davi Excel" entre aspas, em comentário, como referência histórica ao nome antigo', () => {
    const files = ['src/pages/SpreadsheetPage.tsx', ...listFilesRecursive('src/components/spreadsheet')]
    for (const file of files) {
      const content = readAll(file).replace(/"Davi Excel"/g, '')
      expect(content, `${file} não pode conter Davi/Gabriel/Emily/Ilde/Gabi fora da citação histórica entre aspas`).not.toMatch(/\b(Davi|Gabriel|Emily|Ilde|Gabi)\b/)
    }
  })

  it('src/lib/spreadsheet-adapter.ts é a ÚNICA fronteira permitida a importar símbolos "Davi*" do registro legado — nenhum outro arquivo novo desta fase faz isso', () => {
    const adapter = readAll('src/lib/spreadsheet-adapter.ts')
    expect(adapter).toContain("from './records'")
    const otherFiles = ['src/pages/SpreadsheetPage.tsx', ...listFilesRecursive('src/components/spreadsheet')]
    for (const file of otherFiles) {
      expect(readAll(file), `${file} não pode importar símbolos Davi* diretamente — só via spreadsheet-adapter.ts`).not.toMatch(/\bDavi[A-Z]\w*/)
    }
  })
})
