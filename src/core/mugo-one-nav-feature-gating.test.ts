import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Fase B da sprint de generalização: módulos ainda estruturalmente
 * verticais (Torre de Controle/tasks, Estoque/inventory,
 * Entregas/shipping, Radar/radar, Interessados/waitlist — ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md) precisam ficar ocultos
 * por padrão para organizações novas, via
 * organization_features/has_organization_feature, não só por
 * permissão. Esta guarda garante que o mapeamento existe e que tanto o
 * Sidebar (menu) quanto o App (rota direta) o consultam — sem isto,
 * digitar a URL direto contornaria o menu escondido.
 */
describe('nav feature gating — módulos verticais ocultos por padrão para organizações novas', () => {
  const routing = readFileSync('src/routing.ts', 'utf8')
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')

  it('routing.ts mapeia os cinco módulos ainda verticais para um FeatureCode', () => {
    expect(routing).toContain("'Torre de Controle':'tasks'")
    expect(routing).toContain("'Estoque':'inventory'")
    expect(routing).toContain("'Entregas':'shipping'")
    expect(routing).toContain("'Radar':'radar'")
    expect(routing).toContain("'Interessados':'waitlist'")
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
