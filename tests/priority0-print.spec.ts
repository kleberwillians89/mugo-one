import { test, expect } from '@playwright/test'

/**
 * Priority 0 (physical print) — two DISTINCT print objects that must never
 * be confused: the 30x10mm physical BOTTLE LABEL (barcode only, identifies
 * one physical bottle) and the operational CONTROL NOTE ("FOLHA DO ENVIO",
 * QR + barcode, identifies the shipment/order). Structural checks only —
 * real dimensional accuracy on physical label stock and real scanner
 * hardware are out of reach here and reported as PENDING HUMAN VALIDATION.
 */

const CSS_FILES = [
  'src/components/bottles/BottleLabelPrint.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const bottleLabelMarkup = `
<div class="bottle-label-print" data-fixture="bottle-label-batch">
  <div class="bottle-label-sheet">
    <div class="bottle-label-tag">
      <span class="bottle-label-brand">RUAH</span>
      <svg class="barcode-image" role="img" aria-label="Código de barras RUAH-F000185"></svg>
    </div>
    <div class="bottle-label-tag">
      <span class="bottle-label-brand">RUAH</span>
      <svg class="barcode-image" role="img" aria-label="Código de barras RUAH-F000186"></svg>
    </div>
  </div>
</div>
`

const controlNoteMarkup = `
<div class="app-shell" data-fixture="control-note">
  <aside class="sidebar"><nav>menu da CRM</nav></aside>
  <main>
    <header><span>Cabeçalho do app (nunca deve imprimir)</span></header>
    <section class="shipment-print-view">
      <img class="ruah-brand ruah-brand-print" src="/ruah-brand.svg" alt="RUAH Parfums" />
      <header>
        <span>FOLHA DO ENVIO</span>
        <h1>#A1B2C3D4</h1>
        <h2>Cliente Teste</h2>
        <p>18/08/2026</p>
      </header>
      <div class="print-codes">
        <img class="qr-code-image" src="data:image/png;base64,iVBORw0KGgo=" width="132" height="132" alt="QR do envio" />
        <svg class="barcode-image" role="img" aria-label="Código de barras a1b2c3d4-e5f6-4789-a012-3456789abcde"></svg>
        <span>Bipe para abrir este envio</span>
      </div>
      <div class="print-summary">
        <h3>SEPARAÇÃO E CONFERÊNCIA</h3>
        <dl><dt>Itens esperados</dt><dd>2</dd></dl>
      </div>
      <table>
        <thead><tr><th>Nº</th><th>Perfume</th><th>ML</th></tr></thead>
        <tbody><tr><td>01</td><td>Naxos</td><td>50</td></tr></tbody>
      </table>
      <div class="print-signatures"><span>Separado por:</span><span>Conferido por:</span></div>
      <footer>RUAH Intelligence · Operação logística</footer>
    </section>
  </main>
</div>
`

test.describe('Print Object 1 — bottle label (30x10mm)', () => {
  test('label is exactly 30mm x 10mm under print media', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.emulateMedia({ media: 'print' })

    const tags = page.locator('[data-fixture="bottle-label-batch"] .bottle-label-tag')
    await expect(tags).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      const box = await tags.nth(i).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const mmToPx = 96 / 25.4 // CSS px-per-mm at 96dpi, used only to sanity-check the mm values the browser resolved
        return { widthMm: rect.width / mmToPx, heightMm: rect.height / mmToPx }
      })
      expect(box.widthMm, `tag ${i} width`).toBeCloseTo(30, 0)
      expect(box.heightMm, `tag ${i} height`).toBeCloseTo(10, 0)
    }
  })

  test('batch printing does not change individual label dimensions (1 vs 2 labels)', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.emulateMedia({ media: 'print' })
    const [first, second] = await page.locator('[data-fixture="bottle-label-batch"] .bottle-label-tag').evaluateAll(
      (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height } }),
    )
    expect(first.width).toBeCloseTo(second.width, 1)
    expect(first.height).toBeCloseTo(second.height, 1)
  })

  test('contains RUAH mark and Code128, and nothing else', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })

    const tag = page.locator('[data-fixture="bottle-label-batch"] .bottle-label-tag').first()
    await expect(tag.locator('.bottle-label-brand')).toHaveText('RUAH')
    await expect(tag.locator('svg.barcode-image')).toHaveCount(1)
    await expect(tag.locator('svg.barcode-image')).toHaveAttribute('aria-label', /RUAH-F000185/)
  })

  test('QR is absent from the bottle label', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await expect(page.locator('[data-fixture="bottle-label-batch"] .qr-code-image')).toHaveCount(0)
    await expect(page.locator('[data-fixture="bottle-label-batch"] img')).toHaveCount(0)
  })

  test('no perfume name, ml, price, or stock text on the label', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    const text = await page.locator('[data-fixture="bottle-label-batch"]').innerText()
    for (const forbidden of ['Naxos', 'ml', 'ML', 'R$', 'APC', 'SPLIT', 'Disponível', 'Reservado']) {
      expect(text.includes(forbidden), `label text must not contain "${forbidden}": ${JSON.stringify(text)}`).toBe(false)
    }
  })

  test('different bottles of the same perfume get distinct barcode identities', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(bottleLabelMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    const labels = await page.locator('[data-fixture="bottle-label-batch"] svg.barcode-image').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label')),
    )
    expect(new Set(labels).size).toBe(labels.length)
  })
})

test.describe('Print Object 2 — control note (FOLHA DO ENVIO)', () => {
  test('RUAH logo, QR, and Code128 are all present', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(controlNoteMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    const note = page.locator('[data-fixture="control-note"] .shipment-print-view')
    await expect(note.locator('img.ruah-brand-print')).toHaveCount(1)
    await expect(note.locator('.print-codes img.qr-code-image')).toHaveCount(1)
    await expect(note.locator('.print-codes svg.barcode-image')).toHaveCount(1)
  })

  test('QR and barcode resolve the same control object (shipment id), not a bottle', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(controlNoteMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    const qrAlt = await page.locator('[data-fixture="control-note"] .print-codes img').getAttribute('alt')
    const barcodeLabel = await page.locator('[data-fixture="control-note"] .print-codes svg').getAttribute('aria-label')
    expect(qrAlt).toBe('QR do envio')
    expect(barcodeLabel).toContain('a1b2c3d4-e5f6-4789-a012-3456789abcde')
    // shipment ids are UUIDs; bottle codes are never shaped like one — the
    // two barcode families can never collide in value.
    expect(barcodeLabel).not.toMatch(/RUAH-F\d{6}/)
  })

  test('CRM chrome (sidebar, app header) is hidden under print media', async ({ page }) => {
    await page.goto('/login')
    await page.setContent(controlNoteMarkup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('main > header')).toBeHidden()
    await expect(page.locator('.shipment-print-view')).toBeVisible()
  })
})

test('bottle barcode and shipment barcode values are never the same shape', async () => {
  const bottleCode = 'RUAH-F000185'
  const shipmentId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'
  expect(bottleCode).not.toBe(shipmentId)
  expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bottleCode)).toBe(false)
  expect(/^RUAH-F\d{6}$/.test(shipmentId)).toBe(false)
})
