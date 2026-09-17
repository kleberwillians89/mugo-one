import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { navigation, pagePermission, routes } from '../routing'
import { computeCan, MembershipFlags } from './permissions'

/**
 * Regression suite for "Configurações sumiu mesmo com o backend correto".
 * Root cause era duplo: (1) a Sidebar tinha 13 itens sem scroll interno —
 * em telas mais baixas (ex.: 1366x768) os últimos itens (Interessados,
 * Configurações) ficavam fisicamente cortados abaixo da viewport, sem
 * nenhuma forma de rolar até eles; (2) pageFromPath não reconhecia o
 * prefixo '/configuracoes', então tanto o reload direto de
 * /configuracoes/equipe quanto o clique em "Equipe e acessos" (que navega
 * via pushState+popstate reaproveitando pageFromPath) jogavam o usuário de
 * volta ao Dashboard. Nenhuma das duas causas era sobre permissões — o
 * usuário tinha access_total=true o tempo todo. Sandbox sem DOM real: as
 * asserções de CSS/roteamento são por texto-fonte, mesma convenção do
 * resto da suíte.
 */

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
const sidebarTsx = read('components/Sidebar.tsx')
const stylesCss = read('styles.css')

const flags = (overrides: Partial<MembershipFlags> = {}): MembershipFlags => ({ status: 'active', accessTotal: false, viewAll: false, ...overrides })

describe('A — Configurações existe de fato na navegação, não só na permissão', () => {
  it('está no array navigation (o que a Sidebar de fato itera) e no mapa de rotas', () => {
    expect(navigation.some((entry) => entry.label === 'Configurações')).toBe(true)
    expect(routes['Configurações']).toBe('/configuracoes')
  })
  it('é o ÚLTIMO item da navegação principal, abaixo de todos os módulos operacionais', () => {
    expect(navigation.at(-1)?.label).toBe('Configurações')
  })
})

describe('B/C/D — a mesma condição de visibilidade da Sidebar concede Configurações por access_total, team.view OU team.manage', () => {
  const codes = pagePermission['Configurações']
  it('B: access_total=true concede qualquer um dos códigos da página', () => {
    expect(codes.some((code) => computeCan(code, flags({ accessTotal: true }), new Set()))).toBe(true)
  })
  it('C: team.view=true (sem settings.view) já basta', () => {
    expect(codes.some((code) => computeCan(code, flags(), new Set(['team.view'])))).toBe(true)
  })
  it('D: team.manage=true (sem settings.view, sem team.view) já basta', () => {
    expect(codes.some((code) => computeCan(code, flags(), new Set(['team.manage'])))).toBe(true)
  })
  it('E: sem access_total/view_all e sem nenhum dos três códigos, fica escondido', () => {
    expect(codes.some((code) => computeCan(code, flags(), new Set(['clients.view'])))).toBe(false)
  })
})

describe('F — clicar em Configurações permite chegar em "Equipe e acessos"', () => {
  // A nav de abas (Frete/Equipe/Entradas de Leads) foi extraída para
  // SettingsTabs.tsx (Sprint M) — antes duplicada em ShipmentOperations.tsx
  // e TeamSettingsPage.tsx, uma cópia por página. As duas páginas agora só
  // renderizam <SettingsTabs active="..."/>; a lógica mora em um só lugar.
  const settingsTabs = read('components/SettingsTabs.tsx')
  const teamPage = read('pages/TeamSettingsPage.tsx')
  const shipmentOps = read('components/ShipmentOperations.tsx')
  it('a aba "Equipe e acessos" existe e navega para /configuracoes/equipe via pushState+popstate', () => {
    expect(settingsTabs).toContain('Equipe e acessos')
    expect(settingsTabs).toContain("history.pushState({}, '', path)")
    expect(settingsTabs).toContain("dispatchEvent(new PopStateEvent('popstate'))")
  })
  it('a aba só aparece para quem tem team.view OU team.manage (canTeam)', () => {
    expect(settingsTabs).toContain("useHasPermission('team.view')")
    expect(settingsTabs).toContain("useHasPermission('team.manage')")
    expect(settingsTabs).toContain('canTeam = canViewTeam || canManageTeam')
  })
  it('as duas páginas de Configurações renderizam a mesma <SettingsTabs/>, sem barra de abas duplicada', () => {
    expect(shipmentOps).toContain('<SettingsTabs active="frete"/>')
    expect(teamPage).toContain('<SettingsTabs active="equipe"/>')
  })
})

describe('G — /configuracoes/equipe abre corretamente em navegação direta (reload de URL), não só via clique interno', () => {
  const routing = read('routing.ts')
  it('pageFromPath reconhece o prefixo /configuracoes (não só a rota exata /configuracoes), então um reload em /configuracoes/equipe não cai de volta no Dashboard', () => {
    expect(routing).toContain("location.pathname.startsWith('/configuracoes')?'Configurações'")
  })
  it('dentro de Configurações, App.tsx decide a aba pela URL exata (routePath), então /configuracoes/equipe abre TeamSettingsPage e access_total nunca é bloqueado', () => {
    const appTsx = read('App.tsx')
    expect(appTsx).toContain("const wantsTeam = routePath === '/configuracoes/equipe'")
    expect(appTsx).toContain("const allowed = wantsTeam ? can('team.view') || can('team.manage')")
    expect(appTsx).toContain(": wantsLeadIntake ? can('lead_intake.view')")
    expect(appTsx).toContain(": wantsCommunications ? can('communications.manage')")
  })
})

describe('H — Sidebar com altura pequena continua permitindo alcançar Configurações via scroll interno', () => {
  it('a <nav> da Sidebar (não a página inteira) tem overflow-y:auto e min-height:0 — sem min-height:0 um flex item não encolhe abaixo do seu conteúdo, e o scroll nunca ativaria', () => {
    const navRule = stylesCss.slice(stylesCss.indexOf('.sidebar nav{'), stylesCss.indexOf('.sidebar nav{') + 400)
    expect(navRule).toMatch(/flex:1/)
    expect(navRule).toMatch(/min-height:0/)
    expect(navRule).toMatch(/overflow-y:auto/)
  })
  it('a <aside> da Sidebar tem altura fixa de viewport (top e bottom presos via inset), então o espaço restante para a nav é sempre determinado — nunca cresce sem limite empurrando Configurações para fora da tela', () => {
    const asideRule = stylesCss.slice(stylesCss.indexOf('.sidebar{'), stylesCss.indexOf('.sidebar{') + 200)
    expect(asideRule).toMatch(/inset:0 auto 0 0/)
  })
})

describe('I — nenhuma dependência de e-mail hardcoded para decidir a visibilidade de Configurações', () => {
  it('Sidebar/App/routing/PermissionsContext nunca citam um e-mail literal', () => {
    for (const src of [sidebarTsx, read('App.tsx'), read('routing.ts'), read('lib/PermissionsContext.tsx')]) {
      expect(src).not.toMatch(/@(?!acesso\.ruahparfums)[a-z0-9.-]+\.[a-z]{2,}/i)
      expect(src).not.toContain('parfumsruah')
    }
  })
})
