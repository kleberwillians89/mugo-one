import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 2 — Order Validation. Mobile functional baseline (this round
 * does not redesign visuals — same rule as Fase 1). Verifies the new
 * "Bloqueadas" tab and its table (real .tabs / .ui-table / StatusBadge
 * components, real CSS) never overflow and meet 44px at 390px.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/Table.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const markup = `
<div class="page" data-fixture="sales-blocked">
  <div class="tabs sales-tabs">
    <button>Todas</button>
    <button class="selected">Bloqueadas (3)</button>
  </div>
  <div class="card clients-table">
    <div class="clients-caption"><strong>3 vendas precisam de atenção</strong></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Data</th><th>Cliente</th><th>Perfume</th><th>Valor</th><th>Motivo</th><th>Responsável</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Data">12/08/2026</td>
            <td data-label="Cliente"><strong>Duda Lazzarini de Oliveira</strong></td>
            <td data-label="Perfume">—</td>
            <td data-label="Valor">R$ 1.395,00</td>
            <td data-label="Motivo"><div class="sales-blocking-reasons"><span class="ui-badge ui-badge--warning">Perfume não identificado</span><span class="ui-badge ui-badge--warning">Cadastro do cliente incompleto</span></div></td>
            <td data-label="Responsável"><button>Assumir</button></td>
            <td data-label="Ações"><button>Resolver</button></td>
          </tr>
          <tr>
            <td data-label="Data">11/08/2026</td>
            <td data-label="Cliente"><strong>Tatiana Albuquerque</strong></td>
            <td data-label="Perfume">Naxos</td>
            <td data-label="Valor">R$ 890,00</td>
            <td data-label="Motivo"><div class="sales-blocking-reasons"><span class="ui-badge ui-badge--warning">Pagamento não identificado</span></div></td>
            <td data-label="Responsável"><span class="ui-badge ui-badge--neutral">Davi</span></td>
            <td data-label="Ações"><button>Resolver</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768]

for (const width of WIDTHS) {
  test(`Fase 2 — vendas bloqueadas @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })

    const root = page.locator('[data-fixture="sales-blocked"]')
    await expect(root).toBeVisible()
    const result = await root.evaluate((el, viewport) => {
      const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
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
  })
}
