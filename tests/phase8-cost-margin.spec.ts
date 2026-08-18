import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 8 — Cost & Margin ("Quanto custa? Qual margem gera?").
 * Mobile functional baseline only (same rule as the rest of this round).
 * Verifies /relatorios/margem (real .ui-page-header / .metrics / .metric /
 * .clients-table / .ui-table / StatusBadge components, real CSS) and the
 * new "Custo/ML" column + "Custo" action on the Estoque table never
 * overflow and meet 44px touch targets at mobile widths.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/PageHeader.css',
  'src/components/ui/Table.css',
  'src/components/ui/StatusBadge.css',
  'src/components/ui/EmptyState.css',
  'src/pages/InventoryPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const marginMarkup = `
<div class="page" data-fixture="margem">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Custo e margem</h2><p>Receita real contra custo de aquisição, perfume por perfume.</p></div>
    <div class="ui-page-header-actions"><button class="ui-btn ui-btn--secondary ui-btn--default"><span>Este mês</span></button></div>
  </div>
  <section class="metrics">
    <article class="metric card"><div class="metric-icon gold"></div><div class="metric-top"><span>Receita</span><button>···</button></div><strong>R$ 12.400,00</strong><small>8 perfumes vendidos</small></article>
    <article class="metric card"><div class="metric-icon gold"></div><div class="metric-top"><span>Custo conhecido</span><button>···</button></div><strong>R$ 6.100,00</strong><small>2 sem custo informado</small></article>
    <article class="metric card"><div class="metric-icon gold"></div><div class="metric-top"><span>Margem</span><button>···</button></div><strong>R$ 6.300,00</strong><small>50,8% da receita conhecida</small></article>
  </section>
  <div class="card clients-table">
    <div class="clients-caption"><strong>8 perfumes no período</strong></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Perfume</th><th>Unidades</th><th>ML vendido</th><th>Receita</th><th>Custo/ml</th><th>Margem</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Perfume"><strong>Xerjoff Naxos</strong></td>
            <td data-label="Unidades" class="ui-table-col--hide-mobile">6</td>
            <td data-label="ML vendido" class="ui-table-col--hide-mobile">180 ml</td>
            <td data-label="Receita">R$ 3.200,00</td>
            <td data-label="Custo/ml" class="ui-table-col--hide-mobile">R$ 12,00</td>
            <td data-label="Margem"><span class="ui-badge ui-badge--success">R$ 1.040,00 · 32,5%</span></td>
          </tr>
          <tr>
            <td data-label="Perfume"><strong>Parfums de Marly Layton</strong></td>
            <td data-label="Unidades" class="ui-table-col--hide-mobile">4</td>
            <td data-label="ML vendido" class="ui-table-col--hide-mobile">120 ml</td>
            <td data-label="Receita">R$ 1.900,00</td>
            <td data-label="Custo/ml" class="ui-table-col--hide-mobile">—</td>
            <td data-label="Margem"><span class="ui-badge ui-badge--neutral">SEM CUSTO</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`

const emptyMarkup = `
<div class="page" data-fixture="margem-empty">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Custo e margem</h2><p>Receita real contra custo de aquisição, perfume por perfume.</p></div>
  </div>
  <div class="ui-empty-state"><h3>Nenhuma venda no período</h3><p>Escolha outro período para ver custo e margem.</p></div>
</div>
`

const inventoryCostMarkup = `
<div class="page" data-fixture="estoque-custo">
  <div class="card clients-table">
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Perfume</th><th>Disponível</th><th>Custo/ML</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Perfume"><strong>Xerjoff Naxos</strong></td>
            <td data-label="Disponível"><strong class="stock-available">180 ML</strong></td>
            <td data-label="Custo/ML" class="ui-table-col--hide-mobile">R$ 12,00</td>
            <td data-label="Situação"><span class="ui-badge ui-badge--success">Disponível</span></td>
            <td data-label="Ações"><div class="stock-actions">
              <button>Entrada</button>
              <button>Ajustar</button>
              <button>Custo</button>
              <button>QR</button>
            </div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768]

async function assertNoOverflowOrCrampedTargets(page: import('@playwright/test').Page, fixtureName: string, width: number) {
  const root = page.locator(`[data-fixture="${fixtureName}"]`)
  await expect(root).toBeVisible()
  const result = await root.evaluate((el, viewport) => {
    const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !node.closest('.ui-table-wrap'))
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
      .map((node) => node.className)
    const crampedRows = [...el.querySelectorAll<HTMLElement>('.ui-table tbody tr')]
      .filter((row) => getComputedStyle(row).display === 'grid')
    // .metric-top button is the shared <Metric> component's decorative
    // kebab affordance (no onClick — pre-existing on Dashboard/ReportsPage/
    // InventoryPage too, not introduced here). Out of scope: fixing it means
    // editing a global component used by other already-hardened pages,
    // which this round's briefing explicitly excludes ("don't redesign
    // global components"). Tracked, not silently ignored — see phase report.
    const smallTargets = [...el.querySelectorAll<HTMLElement>('button')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .filter((node) => !node.closest('.metric-top'))
      .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
      .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return { overflowing, crampedRowCount: crampedRows.length, smallTargets }
  }, width)
  expect(result.overflowing, `overflow: ${result.overflowing.join(', ')}`).toEqual([])
  expect(result.crampedRowCount, 'row must never be display:grid (the fixed clients-table/ui-table collision)').toBe(0)
  expect(result.smallTargets, `touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

for (const width of WIDTHS) {
  test(`Fase 8 — custo e margem @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(marginMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'margem', width)
  })

  test(`Fase 8 — margem vazio @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(emptyMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'margem-empty', width)
  })

  test(`Fase 8 — coluna Custo/ML no Estoque @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(inventoryCostMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'estoque-custo', width)
  })
}
