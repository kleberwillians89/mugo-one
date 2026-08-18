import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const replenishmentCss = readFileSync(new URL('./ReplenishmentPage.css', import.meta.url), 'utf8')
const dashboardCss = readFileSync(new URL('./Dashboard.css', import.meta.url), 'utf8')

describe('ReplenishmentPage/Dashboard seguem o container real da página (390/768/1024/1280/1440)', () => {
  it('ReplenishmentPage.css usa @container page, não @media de viewport, e herda container-type de .page', () => {
    expect(replenishmentCss).toMatch(/@container page \(max-width:\d+px\)/)
    expect(replenishmentCss).not.toContain('container-type')
  })

  it('Dashboard.css usa @container page para a nova seção de atenção', () => {
    expect(dashboardCss).toMatch(/@container page \(max-width:\d+px\)/)
    expect(dashboardCss).not.toContain('container-type')
  })

  it('cards de reposição empilham em coluna única em telas estreitas (zero overflow)', () => {
    expect(replenishmentCss).toMatch(/@container page \(max-width:900px\)\{\s*\.replenishment-grid\{grid-template-columns:1fr\}/)
  })

  it('botão "Buscar reposição" fica com altura mínima confortável para toque (item 27 do spec)', () => {
    expect(replenishmentCss).toContain('min-height:44px')
  })
})
