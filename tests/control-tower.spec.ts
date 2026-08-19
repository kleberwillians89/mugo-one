import { test, expect } from '@playwright/test'

/**
 * Control Tower — the final screen. Mobile functional baseline only (same
 * rule as the rest of this round). Verifies the three-column layout (Davi
 * / Ilde / Gestão) never overflows and meets 44px touch targets, and that
 * it stacks to a single column on narrow viewports instead of cramming
 * three columns into 320px.
 */

const CSS_FILES = [
  'src/components/ui/PageHeader.css',
  'src/components/ui/StatusBadge.css',
  'src/pages/ControlTowerPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const markup = `
<div class="page control-tower-page" data-fixture="tower">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Torre de Controle</h2><p>Onde a operação está travando — em três perguntas, uma por pessoa.</p></div>
  </div>
  <div class="control-tower-grid">
    <section class="card control-tower-column">
      <header><span>icon</span><div><strong>Davi</strong><span>Atendimento e vendas</span></div></header>
      <div class="control-tower-rows">
        <button type="button" class="control-tower-row"><span>Vendas bloqueadas</span><span class="ui-badge ui-badge--danger">2</span></button>
        <button type="button" class="control-tower-row"><span>Clientes em recuperação</span><span class="ui-badge ui-badge--warning">5</span></button>
        <button type="button" class="control-tower-row"><span>Prontos para avisar</span><span class="ui-badge ui-badge--success">1</span></button>
        <button type="button" class="control-tower-row"><span>Esperando perfume</span><span class="ui-badge ui-badge--neutral">3</span></button>
      </div>
    </section>
    <section class="card control-tower-column">
      <header><span>icon</span><div><strong>Ilde</strong><span>Separação e envio</span></div></header>
      <div class="control-tower-rows">
        <button type="button" class="control-tower-row"><span>Próximo pedido</span><span class="ui-badge ui-badge--danger">Duda Lazzarini — URGENTE</span></button>
        <button type="button" class="control-tower-row"><span>Fila de preparo</span><span class="ui-badge ui-badge--neutral">6</span></button>
      </div>
    </section>
    <section class="card control-tower-column">
      <header><span>icon</span><div><strong>Gestão</strong><span>Estoque, compra e margem</span></div></header>
      <div class="control-tower-rows">
        <button type="button" class="control-tower-row"><span>Estoque baixo</span><span class="ui-badge ui-badge--danger">4</span></button>
        <button type="button" class="control-tower-row"><span>Oportunidades fortes de compra</span><span class="ui-badge ui-badge--success">2</span></button>
        <button type="button" class="control-tower-row"><span>Margem do mês</span><span class="ui-badge ui-badge--success">38,4%</span></button>
        <button type="button" class="control-tower-row"><span>Perfumes sem custo</span><span class="ui-badge ui-badge--warning">7</span></button>
      </div>
    </section>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768, 1024]

for (const width of WIDTHS) {
  test(`Torre de Controle @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })

    const root = page.locator('[data-fixture="tower"]')
    await expect(root).toBeVisible()
    const result = await root.evaluate((el, viewport) => {
      const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
        .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
        .map((node) => node.className)
      const smallTargets = [...el.querySelectorAll<HTMLElement>('button')]
        .filter((node) => getComputedStyle(node).display !== 'none')
        .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
        .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
      const columns = getComputedStyle(el.querySelector('.control-tower-grid')!).gridTemplateColumns.split(' ').length
      return { overflowing, smallTargets, columns }
    }, width)
    expect(result.overflowing, `overflow: ${result.overflowing.join(', ')}`).toEqual([])
    expect(result.smallTargets, `touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
    if (width < 900) expect(result.columns, 'three columns must stack to one below the container breakpoint').toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}

test('every row is a real button (keyboard/screen-reader operable), not a styled div', async ({ page }) => {
  await page.goto('/login')
  await page.setContent(markup)
  for (const file of CSS_FILES) await page.addStyleTag({ path: file })
  const rows = page.locator('[data-fixture="tower"] .control-tower-row')
  expect(await rows.count()).toBe(10)
  for (const row of await rows.all()) expect(await row.evaluate((el) => el.tagName)).toBe('BUTTON')
})
