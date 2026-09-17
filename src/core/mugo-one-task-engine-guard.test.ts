import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do Task Engine universal (Sprint K/L) — ver
 * docs/TASK_ENGINE_MIGRATION_PLAN.md. Cobre os riscos reais de
 * reverticalização desta sprint: Torre de Controle voltar a ser
 * roteada, e termos/nomes verticais vazando para os arquivos novos.
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

const NEW_TASK_ENGINE_FILES = [
  'src/lib/tasks.ts', 'src/lib/activities.ts',
  'src/pages/TasksPage.tsx',
  'src/components/NewTaskModal.tsx', 'src/components/TaskDetailDrawer.tsx', 'src/components/EntityTasksBlock.tsx',
]

describe('task engine guard — Torre de Controle não pode voltar a ser roteada', () => {
  it('os 3 arquivos legados continuam existindo (isolados, não apagados) em src/legacy/control-tower/', () => {
    const files = listFilesRecursive('src/legacy/control-tower')
    for (const name of ['ControlTowerPage.tsx', 'control-tower.ts', 'ControlTowerPage.css']) {
      expect(files.some((f) => f.endsWith(name)), `${name} deveria continuar existindo em src/legacy/control-tower/`).toBe(true)
    }
  })

  it('routing.ts/App.tsx não roteiam mais para ControlTowerPage — "Tarefas" (Task Engine) ocupou o lugar', () => {
    const routing = readAll('src/routing.ts')
    const app = readAll('src/App.tsx')
    expect(app).not.toContain('ControlTowerPage')
    expect(app).toContain('TasksPage')
    expect(routing).not.toMatch(/'Torre de Controle'\s*[,:|]/)
    expect(routing).toContain("'Tarefas':'/tarefas'")
  })

  it('as permissions novas do Task Engine (tasks.view/create/edit/assign/manage) são distintas das 4 antigas (tasks.sales/split/shipping/management, ligadas a identidade de pessoas reais numa migration histórica)', () => {
    const permissions = readAll('src/lib/permissions.ts')
    for (const code of ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.manage']) {
      expect(permissions).toContain(`code: '${code}'`)
    }
    // As 4 antigas continuam existindo (legado, ainda referenciadas por
    // LEGACY_ONLY_PERMISSION_CODES/control-tower.ts) — só não podem
    // aparecer como parte do módulo 'task_engine' novo.
    expect(permissions).toContain("module: 'tasks'")
  })
})

describe('task engine guard — arquivos novos não contêm termos verticais nem nomes de pessoas', () => {
  const forbidden = ['perfume', 'frasco', 'splitar', 'bottle', 'apc', 'ruahparfums']

  it('nenhum arquivo novo do Task Engine contém termos verticais', () => {
    for (const file of NEW_TASK_ENGINE_FILES) {
      const content = readAll(file).toLowerCase()
      for (const word of forbidden) {
        expect(content, `${file} não pode conter "${word}"`).not.toContain(word)
      }
    }
  })

  it('nenhuma pessoa da operação antiga aparece nos arquivos novos do Task Engine', () => {
    for (const file of NEW_TASK_ENGINE_FILES) {
      expect(readAll(file)).not.toMatch(/\b(Davi|Gabriel|Emily|Ilde|Gabi)\b/)
    }
  })
})

describe('task engine guard — Kanban não assume segmento nenhum', () => {
  it('TasksPage.tsx usa só os 5 status/4 prioridades universais, nenhuma coluna ou rótulo específico de setor', () => {
    const page = readAll('src/pages/TasksPage.tsx')
    expect(page).toContain('KANBAN_STATUSES')
    expect(page).not.toMatch(/\b(veterinaria|oficina|correspondente|imobiliaria|clinica)\b/i)
  })
})
