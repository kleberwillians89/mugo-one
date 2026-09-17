import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MembershipFlags, computeCan } from './permissions'

/**
 * Regression suite for the "Configurações sumiu da Sidebar mesmo com
 * access_total=true" bug. computeCan is a pure function — testable
 * directly. App.tsx/Sidebar.tsx/PermissionsContext.tsx wiring (no live
 * DOM render in this sandbox) is asserted via source text, same
 * convention as the rest of this session's suites.
 */

const flags = (overrides: Partial<MembershipFlags> = {}): MembershipFlags => ({ status: 'active', accessTotal: false, viewAll: false, ...overrides })

describe('1/2 — access_total=true concede QUALQUER código, mesmo fora do conjunto plano vindo do backend', () => {
  it('1: Configurações (settings.view) — mesmo com o Set vazio', () => {
    expect(computeCan('settings.view', flags({ accessTotal: true }), new Set())).toBe(true)
  })
  it('2: Equipe (team.view) — mesmo com o Set vazio', () => {
    expect(computeCan('team.view', flags({ accessTotal: true }), new Set())).toBe(true)
  })
  it('access_total cobre qualquer código arbitrário do catálogo, não só .view — é a regra literal pedida', () => {
    for (const code of ['inventory.adjust', 'shipping.post', 'cost_margin.edit', 'team.manage']) {
      expect(computeCan(code, flags({ accessTotal: true }), new Set())).toBe(true)
    }
  })
})

describe('3/4 — Configurações aparece com team.view OU team.manage, sem exigir settings.view isoladamente', () => {
  it('3: team.view=true, settings.view=false — team.view concede a si mesmo (está no Set), settings.view continua false', () => {
    const granted = new Set(['team.view'])
    expect(computeCan('team.view', flags(), granted)).toBe(true)
    expect(computeCan('settings.view', flags(), granted)).toBe(false)
  })
  it('4: team.manage=true, settings.view=false — team.manage concede a si mesmo; a UI (App.tsx) usa isso como alternativa a team.view para a aba Equipe', () => {
    const granted = new Set(['team.manage'])
    expect(computeCan('team.manage', flags(), granted)).toBe(true)
    expect(computeCan('settings.view', flags(), granted)).toBe(false)
    const appTsx = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(appTsx).toContain("can('team.view') || can('team.manage')")
  })
})

describe('5 — sem nenhuma permissão relevante, fica escondido', () => {
  it('nem access_total, nem view_all, nem o código no conjunto plano — nega', () => {
    expect(computeCan('settings.view', flags(), new Set(['clients.view']))).toBe(false)
  })
})

describe('8 — membro inativo nunca passa, mesmo com access_total=true na linha', () => {
  it('status inativo ignora access_total — cai no conjunto plano (que já viria vazio do backend para um inativo)', () => {
    expect(computeCan('settings.view', flags({ status: 'inactive', accessTotal: true }), new Set())).toBe(false)
  })
  it('view_all também não passa por cima de status inativo', () => {
    expect(computeCan('clients.view', flags({ status: 'inactive', viewAll: true }), new Set())).toBe(false)
  })
})

describe('view_all mantém a mesma exceção do backend (team.view/audit.view nunca entram na varredura .view)', () => {
  it('view_all concede clients.view mas não team.view/audit.view', () => {
    const active = flags({ viewAll: true })
    expect(computeCan('clients.view', active, new Set())).toBe(true)
    expect(computeCan('team.view', active, new Set())).toBe(false)
    expect(computeCan('audit.view', active, new Set())).toBe(false)
  })
})

describe('6 — rota direta com access_total abre (App.tsx nunca mostra ACESSO RESTRITO para quem tem access_total)', () => {
  const appTsx = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  it('o gate genérico de página usa can(), que já resolve access_total antes de checar o código específico', () => {
    expect(appTsx).toContain('pagePermission[page].some((code) => can(code))')
  })
  it('Configurações usa can() nas duas abas, nunca lê o Set bruto diretamente', () => {
    const configBlock = appTsx.slice(appTsx.indexOf("if (page === 'Configurações')"), appTsx.indexOf('if (!permissionsLoading && !pagePermission'))
    expect(configBlock).not.toContain('.permissions.has')
    expect(configBlock).toContain("can('settings.view')")
  })
})

describe('7 — loading nunca vira "negado" permanente, e nunca fica travado em loading para sempre', () => {
  const ctx = readFileSync(new URL('./PermissionsContext.tsx', import.meta.url), 'utf8')
  it('loading=false é setado tanto no sucesso quanto na falha — nunca fica true para sempre', () => {
    expect(ctx).toContain('setState({ loading: false, error: \'\', permissions, flags, organizationId, operationalSalesStartDate, features })')
    expect(ctx).toMatch(/setState\(\{ loading: false, error:[^,]+, permissions: new Set\(\), flags: null, organizationId: null, operationalSalesStartDate: null, features: new Set\(\) \}\)/)
  })
  it('erro de busca vira um estado PRÓPRIO (error), nunca colapsado dentro de "permissions vazio" sem distinção', () => {
    expect(ctx).toContain('error: string')
    expect(ctx).not.toMatch(/catch\(\(\)\s*=>\s*\{\s*if\s*\(!cancelled\)\s*setState\(\{\s*loading:\s*false,\s*permissions:\s*new Set/)
  })
  it('Sidebar só decide "esconder" quando loading=false — durante loading não declara nada como negado, só espera', () => {
    const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
    expect(sidebar).toContain('loading ? [] :')
  })
})
