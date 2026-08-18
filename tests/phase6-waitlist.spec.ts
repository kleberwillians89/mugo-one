import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 6 — Waitlist ("Quem está esperando perfume?"). Mobile
 * functional baseline only (same rule as the rest of this round). Verifies
 * the /interessados list (real .ui-page-header / .clients-table / .ui-table
 * / StatusBadge components, real CSS) and the "Adicionar à lista" modal
 * never overflow and meet 44px touch targets at mobile widths.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/PageHeader.css',
  'src/components/ui/Table.css',
  'src/components/ui/StatusBadge.css',
  'src/components/ui/Modal.css',
  'src/components/ui/EmptyState.css',
  'src/pages/WaitlistPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const listMarkup = `
<div class="page" data-fixture="interessados-list">
  <div class="ui-page-header">
    <div>
      <span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span>
      <h2>Interessados</h2>
      <p>Clientes esperando um perfume voltar ao estoque.</p>
    </div>
    <div class="ui-page-header-actions">
      <button class="ui-btn ui-btn--primary ui-btn--default"><span>Adicionar à lista</span></button>
    </div>
  </div>
  <div class="card clients-table">
    <div class="clients-caption"><strong>3 interessados</strong><span>1 pronto para avisar</span></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Cliente</th><th>Perfume</th><th>Quantidade</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Cliente"><strong>Duda Lazzarini de Oliveira</strong></td>
            <td data-label="Perfume">Xerjoff — Naxos</td>
            <td data-label="Quantidade">50 ml</td>
            <td data-label="Status"><span class="ui-badge ui-badge--success">PRONTO</span></td>
            <td data-label="Ações"><div class="stock-actions">
              <button>Marcar avisado</button>
              <button>Atendido</button>
              <button>Cancelar</button>
            </div></td>
          </tr>
          <tr>
            <td data-label="Cliente"><strong>Tatiana Albuquerque</strong></td>
            <td data-label="Perfume">Parfums de Marly — Layton</td>
            <td data-label="Quantidade">30 ml</td>
            <td data-label="Status"><span class="ui-badge ui-badge--neutral">AVISADO</span></td>
            <td data-label="Ações"><div class="stock-actions">
              <button>Atendido</button>
              <button>Cancelar</button>
            </div></td>
          </tr>
          <tr>
            <td data-label="Cliente"><strong>Marina Costa</strong></td>
            <td data-label="Perfume">Naxos</td>
            <td data-label="Quantidade">100 ml</td>
            <td data-label="Status"><span class="ui-badge ui-badge--warning">AGUARDANDO</span></td>
            <td data-label="Ações"><div class="stock-actions">
              <button>Marcar avisado</button>
              <button>Atendido</button>
              <button>Cancelar</button>
            </div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`

const emptyMarkup = `
<div class="page" data-fixture="interessados-empty">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Interessados</h2><p>Clientes esperando um perfume voltar ao estoque.</p></div>
    <div class="ui-page-header-actions"><button class="ui-btn ui-btn--primary ui-btn--default"><span>Adicionar à lista</span></button></div>
  </div>
  <div class="ui-empty-state">
    <h3>Nenhum interessado na lista</h3>
    <p>Quando um cliente quiser um perfume fora de estoque, adicione-o aqui.</p>
    <button class="ui-btn ui-btn--primary ui-btn--default"><span>Adicionar à lista</span></button>
  </div>
</div>
`

const modalMarkup = `
<div class="page" data-fixture="interessados-modal">
  <div class="ui-modal-layer">
    <button class="ui-modal-scrim" aria-label="Fechar"></button>
    <div class="ui-modal-panel ui-modal-panel--md" role="dialog" aria-modal="true">
      <div class="ui-modal-title">
        <div><span>INTERESSADOS</span><h2>Adicionar à lista de espera</h2></div>
        <button aria-label="Fechar">X</button>
      </div>
      <div class="ui-modal-body">
        <div class="record-form"><div class="form-grid">
          <div class="field wide client-search">
            <span>Cliente</span>
            <div class="search-control"><input placeholder="Busque pelo nome"/></div>
          </div>
          <label class="field wide"><span>Perfume</span>
            <select><option>Selecione…</option></select>
          </label>
          <label class="field"><span>Quantidade desejada (ml)</span><input inputmode="decimal"/></label>
          <label class="field wide"><span>Observações</span><textarea></textarea></label>
        </div></div>
      </div>
      <div class="ui-modal-footer">
        <button class="ui-btn ui-btn--secondary ui-btn--default"><span>Cancelar</span></button>
        <button class="ui-btn ui-btn--primary ui-btn--default"><span>Adicionar</span></button>
      </div>
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
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
      .map((node) => node.className)
    const crampedRows = [...el.querySelectorAll<HTMLElement>('.ui-table tbody tr')]
      .filter((row) => getComputedStyle(row).display === 'grid')
    const smallTargets = [...el.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() || node.tagName }))
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
  test(`Fase 6 — lista de interessados @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(listMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'interessados-list', width)
  })

  test(`Fase 6 — interessados vazio @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(emptyMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'interessados-empty', width)
  })

  test(`Fase 6 — modal adicionar à lista @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(modalMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'interessados-modal', width)
  })
}
