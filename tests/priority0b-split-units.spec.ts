import { test, expect } from '@playwright/test'

/**
 * Priority 0B — physical split unit identity. Three distinct print/scan
 * objects now coexist and must never be confused: PERFUME (product),
 * SOURCE BOTTLE (RUAH-Fxxxxxx, no perfume name, no QR), SPLIT UNIT
 * (RUAH-Sxxxxxx-xxx, perfume name + barcode, no QR, no RUAH logo).
 */

const PRINT_CSS_FILES = [
  'src/components/bottles/SplitLabelPrint.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const splitLabelMarkup = `
<div class="split-label-print" data-fixture="split-label-batch">
  <div class="split-label-sheet">
    <div class="split-label-tag">
      <strong class="split-label-perfume">Xerjoff Naxos</strong>
      <svg class="barcode-image" role="img" aria-label="Código de barras RUAH-S000185-001"></svg>
    </div>
    <div class="split-label-tag">
      <strong class="split-label-perfume">Xerjoff Naxos</strong>
      <svg class="barcode-image" role="img" aria-label="Código de barras RUAH-S000185-002"></svg>
    </div>
  </div>
</div>
`

test.describe('Split label (30x10mm) — perfume name + Code128, no QR, no RUAH logo', () => {
  test('label is exactly 30mm x 10mm under print media', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    await page.emulateMedia({ media: 'print' })

    const tags = page.locator('[data-fixture="split-label-batch"] .split-label-tag')
    await expect(tags).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      const box = await tags.nth(i).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const mmToPx = 96 / 25.4
        return { widthMm: rect.width / mmToPx, heightMm: rect.height / mmToPx }
      })
      expect(box.widthMm, `tag ${i} width`).toBeCloseTo(30, 0)
      expect(box.heightMm, `tag ${i} height`).toBeCloseTo(10, 0)
    }
  })

  test('contains the perfume name and a Code128 barcode identifying the SPLIT, not the source bottle', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    const tag = page.locator('[data-fixture="split-label-batch"] .split-label-tag').first()
    await expect(tag.locator('.split-label-perfume')).toHaveText('Xerjoff Naxos')
    await expect(tag.locator('svg.barcode-image')).toHaveAttribute('aria-label', /RUAH-S000185-001/)
  })

  test('QR is absent from the split label', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    await expect(page.locator('[data-fixture="split-label-batch"] .qr-code-image')).toHaveCount(0)
    await expect(page.locator('[data-fixture="split-label-batch"] img')).toHaveCount(0)
  })

  test('RUAH logo/wordmark is absent from the split label — documented tradeoff for readability at 30x10mm with a variable-length name', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    await expect(page.locator('[data-fixture="split-label-batch"] .bottle-label-brand')).toHaveCount(0)
    await expect(page.locator('[data-fixture="split-label-batch"]')).not.toContainText('RUAH')
  })

  test('no price, stock, ml, or status text — same minimal-identity discipline as the bottle label', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    const text = await page.locator('[data-fixture="split-label-batch"]').innerText()
    for (const forbidden of ['ml', 'ML', 'R$', 'APC', 'Disponível', 'Reservado']) {
      expect(text.includes(forbidden), `label text must not contain "${forbidden}": ${JSON.stringify(text)}`).toBe(false)
    }
  })

  test('batch printing does not change individual label dimensions', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    await page.emulateMedia({ media: 'print' })
    const [first, second] = await page.locator('[data-fixture="split-label-batch"] .split-label-tag').evaluateAll(
      (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height } }),
    )
    expect(first.width).toBeCloseTo(second.width, 1)
    expect(first.height).toBeCloseTo(second.height, 1)
  })

  test('split codes are unique per unit even from the same source bottle', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(splitLabelMarkup)
    for (const file of PRINT_CSS_FILES) await page.addStyleTag({ path: file })
    const labels = await page.locator('[data-fixture="split-label-batch"] svg.barcode-image').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label')),
    )
    expect(new Set(labels).size).toBe(labels.length)
  })
})

test('split-unit barcode and source-bottle barcode are never the same shape (RUAH-Sxxxxxx-xxx vs RUAH-Fxxxxxx)', async () => {
  const splitCode = 'RUAH-S000185-001'
  const bottleCode = 'RUAH-F000185'
  expect(splitCode).not.toBe(bottleCode)
  expect(/^RUAH-S\d{6}-\d{3}$/.test(bottleCode)).toBe(false)
  expect(/^RUAH-F\d{6}$/.test(splitCode)).toBe(false)
})

// --- Batch split creation modal (mobile functional baseline) ---

const MODAL_CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/Modal.css',
  'src/components/bottles/BottleSplitModal.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const splitModalMarkup = `
<div class="page" data-fixture="split-modal">
  <div class="ui-modal-layer">
    <button class="ui-modal-scrim" aria-label="Fechar"></button>
    <div class="ui-modal-panel ui-modal-panel--md" role="dialog" aria-modal="true">
      <div class="ui-modal-title">
        <div><span>ESTOQUE · FRACIONAMENTO</span><h2>Fracionar Frasco 02 — Xerjoff Naxos</h2></div>
        <button aria-label="Fechar">X</button>
      </div>
      <div class="ui-modal-body">
        <div class="bottle-split-form">
          <div class="bottle-split-source"><span>Disponível no frasco fonte</span><strong>85 ml</strong></div>
          <div class="form-grid">
            <label class="field"><span>Quantidade por vidro (ml)</span><input inputmode="decimal" value="5"/></label>
            <label class="field"><span>Número de vidros</span><input inputmode="numeric" value="10"/></label>
          </div>
          <div class="bottle-split-preview">
            <div><span>Total fracionado</span><strong>50 ml</strong></div>
            <div><span>Sobra no frasco fonte</span><strong>35 ml</strong></div>
          </div>
        </div>
      </div>
      <div class="ui-modal-footer">
        <button class="ui-btn ui-btn--secondary ui-btn--default"><span>Cancelar</span></button>
        <button class="ui-btn ui-btn--primary ui-btn--default"><span>Gerar 10 splits</span></button>
      </div>
    </div>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768]

for (const width of WIDTHS) {
  test(`Fracionar modal @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(splitModalMarkup)
    for (const file of MODAL_CSS_FILES) await page.addStyleTag({ path: file })

    const root = page.locator('[data-fixture="split-modal"]')
    await expect(root).toBeVisible()
    const result = await root.evaluate((el, viewport) => {
      const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
        .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
        .map((node) => node.className)
      const smallTargets = [...el.querySelectorAll<HTMLElement>('button, input')]
        .filter((node) => getComputedStyle(node).display !== 'none')
        .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() || node.tagName }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
        .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
      return { overflowing, smallTargets }
    }, width)
    expect(result.overflowing, `overflow: ${result.overflowing.join(', ')}`).toEqual([])
    expect(result.smallTargets, `touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}
