import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do hotfix "ZERO SPLIT NO MUGÔ ONE": split/
 * fracionamento/frasco/perfume/ml não são conceitos do Core. As páginas
 * amadurecidas continuam existindo em src/legacy/operations/ (não foram
 * apagadas), só saíram da navegação/roteamento/permissões ativos.
 */

const FORBIDDEN_WORDS = ['split', 'splitar', 'perfume', 'frasco']

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

describe('zero split guard — split/perfume/frasco/ml não podem ser conceitos do Core ativo', () => {
  it('as 6 páginas legadas continuam existindo (isoladas, não apagadas) em src/legacy/operations/pages/', () => {
    const files = listFilesRecursive('src/legacy/operations/pages')
    for (const name of [
      'FaltaSplitarPage.tsx', 'PreparationPage.tsx', 'SplitsDoDiaPrintPage.tsx',
      'PerfumePrintLabelPage.tsx', 'QrBottlePage.tsx', 'PrintLabelPage.tsx',
    ]) {
      expect(files.some((f) => f.endsWith(name)), `${name} deveria continuar existindo em src/legacy/operations/pages/`).toBe(true)
    }
  })

  it('routing.ts não tem "Falta Splitar" como valor de código (Page union/navigation/routes/pagePermission) — só é permitido em comentário explicando a remoção', () => {
    const routing = readAll('src/routing.ts')
    expect(routing).not.toMatch(/\|'Falta Splitar'\|/)
    expect(routing).not.toMatch(/\{\s*label:\s*'Falta Splitar'/)
    expect(routing).not.toMatch(/'Falta Splitar':/)
    expect(routing).not.toContain('falta-splitar')
  })

  it('App.tsx não importa nem renderiza FaltaSplitarPage/PreparationPage como componente — só é permitido em comentário explicando a remoção', () => {
    const app = readAll('src/App.tsx')
    expect(app).not.toContain("from './pages/FaltaSplitarPage'")
    expect(app).not.toContain("from './pages/PreparationPage'")
    expect(app).not.toContain('<FaltaSplitarPage')
    expect(app).not.toContain('<PreparationPage')
  })

  it('Auth.tsx não importa nem monta QrBottlePage/PrintLabelPage/PerfumePrintLabelPage/SplitsDoDiaPrintPage', () => {
    const auth = readAll('src/Auth.tsx')
    for (const name of ['QrBottlePage', 'PrintLabelPage', 'PerfumePrintLabelPage', 'SplitsDoDiaPrintPage']) {
      expect(auth).not.toContain(`'./pages/${name}'`)
      expect(auth).not.toContain(`<${name}`)
    }
  })

  it('tasks.split/inventory.split ficam marcados como legacy-only e escondidos da UI de permissões', () => {
    const permissions = readAll('src/lib/permissions.ts')
    expect(permissions).toContain("LEGACY_ONLY_PERMISSION_CODES = new Set(['tasks.split', 'inventory.split'])")
    const teamPage = readAll('src/pages/TeamSettingsPage.tsx')
    expect(teamPage).toContain('ACTIVE_PERMISSION_CATALOG')
    expect(teamPage).toContain('!LEGACY_ONLY_PERMISSION_CODES.has(entry.code)')
  })

  it('nenhum arquivo de produção em src/core ou src/modules/crm menciona split/splitar/perfume/frasco como conceito de domínio', () => {
    // Arquivos .test.ts são excluídos da varredura estrita: os próprios
    // testes de guarda (este, mugo-one-decoupling.test.ts,
    // crm-commercial-foundation.test.ts) precisam CITAR essas palavras
    // para verificar a ausência delas em outro lugar — isso não é uma
    // reintrodução do conceito, é a própria proteção.
    const files = [...listFilesRecursive('src/core'), ...listFilesRecursive('src/modules/crm')].filter(
      (file) => !file.replace(/\\/g, '/').endsWith('.test.ts'),
    )
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const content = readAll(file).toLowerCase()
      for (const word of FORBIDDEN_WORDS) {
        expect(content, `${file} não pode mencionar "${word}" como conceito de domínio`).not.toContain(word)
      }
    }
  })

  it('src/modules/crm não referencia "ml" como unidade de domínio (heurística: "_ml"/" ml "/"ml)" fora de contextos neutros como "html"/"normal")', () => {
    const files = listFilesRecursive('src/modules/crm')
    for (const file of files) {
      const content = readAll(file)
      expect(content, `${file} não pode usar "_ml" como sufixo de campo (unidade de mililitros)`).not.toMatch(/_ml\b/i)
    }
  })

  // Achado real ao validar o bundle publicado: Dashboard/ControlTowerPage/
  // ShipmentOperations (páginas ATIVAS, não legado) linkavam ou citavam
  // "Falta Splitar"/"Gabriel"/"Splitar" mesmo depois da página em si ser
  // isolada. A varredura acima (src/core, src/modules/crm) não cobre
  // src/pages nem src/components de propósito — são módulos operacionais
  // amplos que ainda citam perfume/ml legitimamente (ex: InventoryPage).
  // Este bloco cobre só os pontos específicos que vazavam split/Gabriel.
  it('Dashboard/ControlTowerPage/ShipmentOperations não linkam nem citam a fila de split isolada', () => {
    const dashboard = readAll('src/pages/Dashboard.tsx')
    expect(dashboard).not.toContain('/falta-splitar')

    const controlTower = readAll('src/pages/ControlTowerPage.tsx')
    expect(controlTower).not.toContain('/falta-splitar')
    expect(controlTower).not.toContain('title="Gabriel"')
    expect(controlTower).not.toContain('goToSplits')

    const shipmentOps = readAll('src/components/ShipmentOperations.tsx')
    expect(shipmentOps).not.toContain('/falta-splitar')
    expect(shipmentOps).not.toContain('Gabriel')
    expect(shipmentOps).not.toContain('Falta Splitar')
  })
})
