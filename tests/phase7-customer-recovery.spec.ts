import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 7 — Customer Recovery ("Quem está deixando de comprar?").
 * Mobile functional baseline only (same rule as the rest of this round).
 * Verifies the /clientes/recuperacao queue (real .ui-page-header /
 * .clients-table / .ui-table / StatusBadge components, real CSS) and its
 * empty state never overflow and meet 44px touch targets at mobile widths.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/PageHeader.css',
  'src/components/ui/Table.css',
  'src/components/ui/StatusBadge.css',
  'src/components/ui/EmptyState.css',
  'src/pages/ClientRecoveryPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const listMarkup = `
<div class="page" data-fixture="recuperacao-list">
  <div class="ui-page-header">
    <div>
      <span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span>
      <h2>Recuperação de clientes</h2>
      <p>Clientes que já compraram e pararam — sem alerta, ninguém liga.</p>
    </div>
  </div>
  <div class="card clients-table">
    <div class="clients-caption"><strong>3 clientes sem comprar há 90+ dias</strong></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Cliente</th><th>Contato</th><th>Última compra</th><th>Sem comprar</th><th>Total histórico</th><th>Responsável</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Cliente"><strong>Duda Lazzarini de Oliveira</strong></td>
            <td data-label="Contato" class="ui-table-col--hide-mobile"><span class="recovery-contact">11999990000</span></td>
            <td data-label="Última compra">14/02/2026</td>
            <td data-label="Sem comprar"><span class="ui-badge ui-badge--danger">185 dias</span></td>
            <td data-label="Total histórico" class="ui-table-col--hide-mobile">R$ 4.200,00</td>
            <td data-label="Responsável"><button>Assumir</button></td>
            <td data-label="Ações"><div class="recovery-actions">
              <button>Ver dossiê</button>
            </div></td>
          </tr>
          <tr>
            <td data-label="Cliente"><strong>Tatiana Albuquerque</strong></td>
            <td data-label="Contato" class="ui-table-col--hide-mobile"><span class="recovery-contact">11988887777</span></td>
            <td data-label="Última compra">02/05/2026</td>
            <td data-label="Sem comprar"><span class="ui-badge ui-badge--warning">108 dias</span></td>
            <td data-label="Total histórico" class="ui-table-col--hide-mobile">R$ 1.890,00</td>
            <td data-label="Responsável"><span class="ui-badge ui-badge--neutral">Davi</span></td>
            <td data-label="Ações"><div class="recovery-actions">
              <button>Ver dossiê</button>
              <button>Concluir</button>
            </div></td>
          </tr>
          <tr>
            <td data-label="Cliente"><strong>Marina Costa</strong></td>
            <td data-label="Contato" class="ui-table-col--hide-mobile"><span class="recovery-contact">—</span></td>
            <td data-label="Última compra">20/03/2026</td>
            <td data-label="Sem comprar"><span class="ui-badge ui-badge--warning">150 dias</span></td>
            <td data-label="Total histórico" class="ui-table-col--hide-mobile">R$ 760,00</td>
            <td data-label="Responsável"><button>Assumir</button></td>
            <td data-label="Ações"><div class="recovery-actions">
              <button>Ver dossiê</button>
            </div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`

const emptyMarkup = `
<div class="page" data-fixture="recuperacao-empty">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Recuperação de clientes</h2><p>Clientes que já compraram e pararam — sem alerta, ninguém liga.</p></div>
  </div>
  <div class="ui-empty-state">
    <h3>Nenhum cliente em risco</h3>
    <p>Todo cliente com histórico de compras comprou novamente nos últimos 90 dias.</p>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768]

async function assertNoOverflowOrCrampedTargets(page: import('@playwright/test').Page, fixtureName: string, width: number) {
  const root = page.locator(`[data-fixture="${fixtureName}"]`)
  await expect(root).toBeVisible()
  const result = await root.evaluate((el, viewport) => {
    // .ui-table-wrap is the deliberate overflow-x:auto escape hatch for wide
    // tables (7 columns can legitimately need more than a tablet's width) —
    // its descendants may exceed the viewport and scroll internally without
    // that being a bug. What must never happen is the wrap itself, or
    // anything outside it, exceeding the viewport (checked below, plus the
    // page-level scrollWidth assertion after this evaluate call).
    const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !node.closest('.ui-table-wrap'))
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
      .map((node) => node.className)
    const crampedRows = [...el.querySelectorAll<HTMLElement>('.ui-table tbody tr')]
      .filter((row) => getComputedStyle(row).display === 'grid')
    const smallTargets = [...el.querySelectorAll<HTMLElement>('button')]
      .filter((node) => getComputedStyle(node).display !== 'none')
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
  test(`Fase 7 — fila de recuperação @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(listMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'recuperacao-list', width)
  })

  test(`Fase 7 — recuperação vazio @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(emptyMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'recuperacao-empty', width)
  })
}
