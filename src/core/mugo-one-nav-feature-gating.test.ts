import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Fase B da sprint de generalização: módulos ainda estruturalmente
 * verticais (Estoque/inventory, Entregas/shipping, Radar/radar,
 * Interessados/waitlist — ver docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md)
 * precisam ficar ocultos por padrão para organizações novas, via
 * organization_features/has_organization_feature, não só por
 * permissão. Esta guarda garante que o mapeamento existe e que tanto o
 * Sidebar (menu) quanto o App (rota direta) o consultam — sem isto,
 * digitar a URL direto contornaria o menu escondido.
 *
 * 'Torre de Controle' saiu deste mapa na Sprint K/L — não é mais uma
 * página roteada (isolada em src/legacy/control-tower/, ver
 * docs/TASK_ENGINE_MIGRATION_PLAN.md). 'Tarefas' (o Task Engine
 * universal que a substituiu) também mapeia para 'tasks', mas 'tasks'
 * agora é core — o mapeamento existe por consistência (sempre checar
 * feature, mesmo core), não para esconder a tela.
 */
describe('nav feature gating — módulos verticais ocultos por padrão para organizações novas', () => {
  const routing = readFileSync('src/routing.ts', 'utf8')
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')

  it('routing.ts mapeia os quatro módulos ainda verticais para um FeatureCode, e Tarefas para o Task Engine (core)', () => {
    expect(routing).toContain("'Tarefas':'tasks'")
    expect(routing).toContain("'Estoque':'inventory'")
    expect(routing).toContain("'Entregas':'shipping'")
    expect(routing).toContain("'Radar':'radar'")
    expect(routing).toContain("'Interessados':'waitlist'")
    // 'Torre de Controle' ainda é citada em comentário explicando a
    // troca (histórico) — o que não pode existir é como valor de
    // código (Page union / navigation / routes / pagePermission).
    expect(routing).not.toMatch(/'Torre de Controle'\s*[,:|]/)
  })

  it('Sidebar filtra o menu por hasFeature além de permissão — não só permissão', () => {
    expect(sidebar).toContain('hasFeature')
    expect(sidebar).toContain('pageFeature[label]')
  })

  it('App.tsx aplica o mesmo gate na rota direta — digitar a URL não contorna o menu escondido', () => {
    expect(app).toContain('pageFeature[page]')
    expect(app).toContain('hasFeature(requiredFeature)')
  })
})
