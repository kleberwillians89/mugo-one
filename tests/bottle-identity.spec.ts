import { test, expect, Page } from '@playwright/test'

/**
 * Fixture responsive QA for "Modo Ilde" (QR + Code128 bottle identity). Same
 * technique as tests/mobile-hardening.spec.ts: real markup shapes + real CSS
 * files, no auth session (none available in this environment) or camera/
 * scanner hardware. Verifies zero horizontal overflow, 44px touch targets,
 * and that the print layout genuinely hides all CRM chrome.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/Modal.css',
  'src/components/bottles/BottleConferencePanel.css',
  'src/components/bottles/QrCameraScanner.css',
  'src/components/bottles/BottleOnboardingModal.css',
  'src/components/bottles/BottleLabelPrint.css',
  'src/pages/QrBottlePage.css',
  'src/pages/InventoryStationPage.css',
  'src/pages/InventoryCountPage.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const WIDTHS = [320, 375, 390, 430, 768]

const markup = `
<div data-fixture="qr-bottle" class="qr-bottle-page">
  <header class="qr-bottle-header"><span>RUAH</span><strong>Conferência</strong></header>
  <main class="qr-bottle-main">
    <div class="bottle-conference">
      <p class="bottle-conference-eyebrow">XERJOFF</p>
      <h1 class="bottle-conference-perfume">NAXOS</h1>
      <p class="bottle-conference-label">Frasco 02 · F000185</p>
      <div class="bottle-system-value"><span>ESTOQUE ATUAL</span><strong>82 ml</strong></div>
      <label class="bottle-ml-field">
        <span>QUANTO EXISTE FISICAMENTE AGORA?</span>
        <div class="bottle-ml-input-row"><input inputmode="decimal" value="79"/><span>ml</span></div>
      </label>
      <div class="bottle-apc-field">
        <span>APC</span>
        <div class="bottle-apc-options"><button class="active">1 DE 1</button><button>0 DE 1</button></div>
      </div>
      <div class="bottle-diff-preview">
        <div><span>ESTAVA</span><strong>82 ml</strong></div>
        <div><span>CONFERIDO</span><strong>79 ml</strong></div>
        <div><span>DIFERENÇA</span><strong class="negative">-3 ml</strong></div>
      </div>
      <button class="bottle-primary-action">Confirmar 79 ml</button>
    </div>
  </main>
</div>

<div data-fixture="qr-bottle-success" class="qr-bottle-page">
  <main class="qr-bottle-main">
    <div class="bottle-conference bottle-conference--success">
      <div class="bottle-success-icon">✓</div>
      <p class="bottle-success-title">CONFERÊNCIA REGISTRADA</p>
      <h1 class="bottle-conference-perfume">NAXOS · XERJOFF</h1>
      <p class="bottle-conference-label">Frasco 02</p>
      <div class="bottle-success-values"><strong>79 ml</strong><span>APC 1 DE 1</span></div>
      <p class="bottle-success-when">Conferido agora.</p>
      <button class="bottle-primary-action">Ler próximo QR</button>
    </div>
  </main>
</div>

<div data-fixture="station" class="station-page">
  <header class="station-header"><button class="station-back">← Voltar para o estoque</button><span>RUAH</span><strong>Estação de Estoque</strong></header>
  <main class="station-main">
    <div class="station-waiting">
      <button class="station-camera-btn">Ler QR com câmera</button>
      <div class="station-divider"><span>ou bipe o código de barras</span></div>
      <div class="station-listening"><p>Aguardando leitura…</p></div>
      <form class="station-manual">
        <label>Digitar código manualmente</label>
        <div class="station-manual-row"><input placeholder="F000185"/><button type="submit">Abrir</button></div>
      </form>
    </div>
  </main>
</div>

<div data-fixture="count" class="count-page">
  <header class="count-header"><button class="count-back">← Voltar para o estoque</button><span>INVENTÁRIO POR BIP</span><strong>Naxos</strong></header>
  <main class="count-main">
    <div class="count-progress"><div><strong>47</strong><span>esperados</span></div><div><strong>46</strong><span>conferidos</span></div><div><strong>1</strong><span>faltando</span></div></div>
    <button class="count-camera-btn">Ler QR com câmera</button>
    <form class="count-manual"><label>Digitar código manualmente</label><div class="count-manual-row"><input placeholder="F000185"/><button type="submit">Ler</button></div></form>
    <ul class="count-list">
      <li class="found"><span>✓</span><span>F000001</span></li>
      <li class="found"><span>✓</span><span>F000002</span></li>
      <li><span>○</span><span>F000003</span></li>
    </ul>
  </main>
</div>

<div class="ui-modal-layer" data-fixture="onboarding-modal" style="position:relative;inset:auto;padding:20px">
  <div class="ui-modal-panel ui-modal-panel--lg" role="dialog">
    <div class="ui-modal-title"><div><span>ESTOQUE · IDENTIDADE FÍSICA</span><h2>Frascos de Naxos</h2></div><button aria-label="Fechar">×</button></div>
    <div class="ui-modal-body">
      <div class="bottle-onboarding">
        <div class="bottle-onboarding-status">
          <span class="ui-badge ui-badge--warning">IDENTIFICANDO</span>
          <div class="bottle-onboarding-totals"><div><span>ESTOQUE NO SISTEMA</span><strong>180 ml</strong></div><div><span>TOTAL IDENTIFICADO</span><strong>178 ml</strong></div></div>
          <p class="bottle-onboarding-diff">DIFERENÇA: -2 ml — ajuste um frasco ou o estoque antes de finalizar.</p>
        </div>
        <ul class="bottle-onboarding-list">
          <li><label class="bottle-onboarding-checkbox"><input type="checkbox"/></label><div class="bottle-onboarding-item-info"><strong>Frasco 01</strong><span>F000001 · 100 ml · APC 1 DE 1</span></div><button class="bottle-onboarding-print-one">Etiqueta</button></li>
          <li><label class="bottle-onboarding-checkbox"><input type="checkbox"/></label><div class="bottle-onboarding-item-info"><strong>Frasco 02</strong><span>F000002 · 78 ml · APC 0 DE 1</span></div><button class="bottle-onboarding-print-one">Etiqueta</button></li>
        </ul>
        <div class="bottle-onboarding-actions">
          <div class="bottle-onboarding-generate"><input placeholder="Nome do frasco (ex.: Frasco 03)"/><button class="ui-btn ui-btn--primary">Gerar identidade</button></div>
          <div class="bottle-onboarding-buttons"><button class="ui-btn ui-btn--secondary">Imprimir selecionadas (0)</button><button class="ui-btn ui-btn--primary" disabled>Finalizar identificação</button></div>
        </div>
      </div>
    </div>
    <div class="ui-modal-footer"><button class="ui-btn ui-btn--secondary">Iniciar inventário por bip</button><button class="ui-btn ui-btn--secondary">Fechar</button></div>
  </div>
</div>

<div data-fixture="print" class="bottle-label-print">
  <div class="bottle-label-sheet">
    <div class="bottle-label-tag"><span class="bottle-label-brand">RUAH</span><strong class="bottle-label-perfume">NAXOS</strong><span class="bottle-label-frasco">Frasco 02</span><div style="width:120px;height:120px;background:#000"></div><svg class="barcode-image"></svg><small class="bottle-label-house">XERJOFF</small></div>
  </div>
</div>
<div data-fixture="chrome-should-hide">
  <aside class="sidebar">SIDEBAR</aside>
  <header>HEADER</header>
</div>`

async function auditFixture(page: Page, fixture: string) {
  const target = page.locator(`[data-fixture="${fixture}"]`)
  await expect(target).toBeVisible()
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement
    const viewport = document.documentElement.clientWidth
    const overflowing = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
      .map((node) => `${node.tagName}.${[...node.classList].join('.')}`)
    const smallTargets = [...root.querySelectorAll<HTMLElement>('button,a,input,select')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      // A checkbox/radio wrapped in <label> is tappable across the whole
      // label (native browser behavior) — that's its real target, not the
      // small visible box, matching how a real accessibility audit reads it.
      .map((node) => {
        const isBareCheckable = (node as HTMLInputElement).type === 'checkbox' || (node as HTMLInputElement).type === 'radio'
        const label = isBareCheckable ? node.closest('label') : null
        const measured = label ?? node
        return { box: measured.getBoundingClientRect(), label: node.textContent?.trim() || node.getAttribute('aria-label') || node.getAttribute('placeholder') }
      })
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
      .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return { overflowing, smallTargets }
  }, `[data-fixture="${fixture}"]`)
}

for (const width of WIDTHS) {
  test(`bottle identity fixtures @ ${width}px — zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.addStyleTag({ content: '[data-fixture]{margin-bottom:24px;display:block}' })

    for (const fixture of ['qr-bottle', 'qr-bottle-success', 'station', 'count', 'onboarding-modal']) {
      const result = await auditFixture(page, fixture)
      expect(result.overflowing, `${fixture}@${width}: overflow: ${result.overflowing.join(', ')}`).toEqual([])
      expect(result.smallTargets, `${fixture}@${width}: touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `tests/screenshots/bottle-identity-${width}.png`, fullPage: true })
  })
}

test('print layout hides CRM chrome and shows only the label sheet', async ({ page }) => {
  await page.goto('/login')
  await page.setContent(markup)
  for (const file of CSS_FILES) await page.addStyleTag({ path: file })
  await page.emulateMedia({ media: 'print' })

  const sidebarVisible = await page.locator('.sidebar').first().isVisible()
  const headerVisible = await page.locator('[data-fixture="chrome-should-hide"] > header').first().isVisible()
  const printVisible = await page.locator('[data-fixture="print"]').isVisible()
  const printContent = await page.locator('.bottle-label-perfume').first().textContent()

  expect(sidebarVisible, 'sidebar must be hidden under print').toBe(false)
  expect(headerVisible, 'CRM header must be hidden under print').toBe(false)
  expect(printVisible, 'the label sheet must be visible under print').toBe(true)
  expect(printContent?.trim()).toBe('NAXOS')
})

test('print layout stays hidden on screen (no accidental double-render)', async ({ page }) => {
  await page.goto('/login')
  await page.setContent(markup)
  for (const file of CSS_FILES) await page.addStyleTag({ path: file })
  await expect(page.locator('[data-fixture="print"]')).toBeHidden()
})
