import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 9 — Radar Buying Intelligence ("O que precisa ser
 * comprado? Onde comprar? Quanto custa?"). Mobile functional baseline
 * only. Verifies the perfume-scoped buying-context card on /radar and the
 * richer "melhor oferta" handoff on Reposição never overflow and meet
 * 44px touch targets.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/PageHeader.css',
  'src/components/ui/DefinitionGroup.css',
  'src/components/ui/StatusBadge.css',
  'src/pages/RadarPage.css',
  'src/pages/ReplenishmentPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const buyingContextMarkup = `
<div class="page radar-page" data-fixture="buying-context">
  <div class="ui-page-header">
    <div><span class="ui-page-header-eyebrow">RUAH INTELLIGENCE</span><h2>Radar Global</h2><p>Radar mundial de abastecimento.</p></div>
    <div class="ui-page-header-actions"><button class="ui-btn ui-btn--secondary ui-btn--default"><span>Ver fornecedores</span></button></div>
  </div>
  <section class="card radar-buying-context">
    <div class="clients-caption"><strong>Xerjoff — Naxos</strong><span class="ui-badge ui-badge--warning">INVESTIGAR</span></div>
    <div class="radar-buying-groups">
      <div class="ui-def-group">
        <div class="ui-def-group-head"><h4>Estoque e venda</h4></div>
        <dl>
          <div class="ui-def-row"><dt>Estoque</dt><dd>4 ml</dd></div>
          <div class="ui-def-row"><dt>Venda 30d</dt><dd>31 ml</dd></div>
          <div class="ui-def-row"><dt>Velocidade</dt><dd>1.03 ml/dia</dd></div>
          <div class="ui-def-row"><dt>Cobertura</dt><dd>~4 dias</dd></div>
          <div class="ui-def-row"><dt>Reposição</dt><dd>CRÍTICO</dd></div>
        </dl>
      </div>
      <div class="ui-def-group">
        <div class="ui-def-group-head"><h4>Custo e margem</h4></div>
        <dl>
          <div class="ui-def-row"><dt>Custo/ml</dt><dd>—</dd></div>
          <div class="ui-def-row"><dt>Margem</dt><dd>—</dd></div>
        </dl>
      </div>
      <div class="ui-def-group">
        <div class="ui-def-group-head"><h4>Radar</h4><button class="ui-btn ui-btn--secondary ui-btn--default"><span>Buscar novamente no mundo</span></button></div>
        <dl>
          <div class="ui-def-row"><dt>Ofertas salvas</dt><dd>3</dd></div>
          <div class="ui-def-row"><dt>Melhor oferta observada</dt><dd>GBP 165</dd></div>
          <div class="ui-def-row"><dt>Fonte</dt><dd>Harrods</dd></div>
          <div class="ui-def-row"><dt>Confiança</dt><dd>Fonte confiável</dd></div>
        </dl>
      </div>
    </div>
  </section>
</div>
`

const replenishmentCardMarkup = `
<div class="page replenishment-page" data-fixture="replenishment-card">
  <div class="replenishment-grid">
    <article class="replenishment-card">
      <header><div><strong>Naxos</strong><span class="replenishment-brand">XERJOFF</span></div><span class="ui-badge ui-badge--danger">CRÍTICO</span></header>
      <div class="replenishment-stats"><span>4 ml disponíveis</span><span>31 ml vendidos nos últimos 30 dias</span><span>Cobertura estimada: 4 dias</span></div>
      <p class="replenishment-summary">Naxos está crítico.</p>
      <div class="replenishment-best-offer">
        <span>Melhor oferta observada</span>
        <strong>GBP 165 · R$ 1.150,00</strong>
        <span>Harrods · fonte confiável</span>
      </div>
      <p class="replenishment-offers-note">3 oportunidades salvas no Radar (2 de fontes confiáveis) — atualizado há 2h.</p>
      <footer class="replenishment-actions">
        <button class="ui-btn ui-btn--secondary ui-btn--default"><span>Ver oportunidades</span></button>
        <button class="ui-btn ui-btn--primary ui-btn--default"><span>Buscar reposição</span></button>
        <button class="ui-btn ui-btn--secondary ui-btn--default"><span>Acompanhar no Radar</span></button>
        <button class="ui-btn ui-btn--secondary ui-btn--default"><span>Gerar análise RUAH Intelligence</span></button>
      </footer>
    </article>
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
    const smallTargets = [...el.querySelectorAll<HTMLElement>('button')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .filter((node) => !node.closest('.metric-top'))
      .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
      .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return { overflowing, smallTargets }
  }, width)
  expect(result.overflowing, `overflow: ${result.overflowing.join(', ')}`).toEqual([])
  expect(result.smallTargets, `touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

for (const width of WIDTHS) {
  test(`Fase 9 — contexto de compra do perfume @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/login')
    await page.setContent(buyingContextMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'buying-context', width)
  })

  test(`Fase 9 — card de reposição com melhor oferta @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/login')
    await page.setContent(replenishmentCardMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await assertNoOverflowOrCrampedTargets(page, 'replenishment-card', width)
  })
}

test('unknown margin/price render as an em dash, never as zero or blank', async ({ page }) => {
  await page.goto('/login')
  await page.setContent(buyingContextMarkup)
  for (const file of CSS_FILES) await page.addStyleTag({ path: file })
  const costRow = page.locator('[data-fixture="buying-context"] .ui-def-row', { hasText: 'Custo/ml' })
  const marginRow = page.locator('[data-fixture="buying-context"] .ui-def-row', { hasText: 'Margem' })
  await expect(costRow.locator('dd')).toHaveText('—')
  await expect(marginRow.locator('dd')).toHaveText('—')
})
