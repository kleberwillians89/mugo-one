import { test, expect } from '@playwright/test'

/**
 * Roadmap FASE 1 — Bottle Separation. Mobile functional baseline only (this
 * round explicitly does not redesign visuals — see the briefing: "MOBILE
 * FUNCTIONAL BASELINE: PASS/FAIL", not "MOBILE VISUAL UX: PASS"). Verifies
 * the new scan trigger/panel/chip states never overflow and meet the 44px
 * touch target at 390px, using the same fixture technique as the rest of
 * this suite (no live session available).
 */

const CSS_FILES = [
  'src/components/bottles/ShipmentBottleScan.css',
  'src/components/bottles/QrCameraScanner.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const markup = `
<div class="page" data-fixture="checklist-untriggered">
  <div class="premium-checklist">
    <article role="row">
      <span class="item-number">01</span>
      <div class="item-name">
        <strong>Xerjoff Naxos</strong>
        <span>50 ML · SPLIT</span>
        <button type="button" class="bottle-scan-trigger">Bipar frasco</button>
      </div>
    </article>
  </div>
</div>

<div class="page" data-fixture="checklist-assigned">
  <div class="premium-checklist">
    <article role="row">
      <span class="item-number">01</span>
      <div class="item-name">
        <strong>Xerjoff Naxos</strong>
        <span>50 ML · SPLIT</span>
        <div class="bottle-scan-chip">Frasco 02 · F000185</div>
      </div>
    </article>
  </div>
</div>

<div class="page" data-fixture="checklist-panel-open">
  <div class="premium-checklist">
    <article role="row">
      <span class="item-number">01</span>
      <div class="item-name">
        <strong>Xerjoff Naxos</strong>
        <span>50 ML · SPLIT</span>
        <div class="bottle-scan-panel">
          <p class="bottle-scan-feedback bottle-scan-feedback--error">⚠ FRASCO DIFERENTE — Frasco 01 é de outro perfume.</p>
          <div class="qr-scanner"><div class="qr-scanner-frame" style="height:200px;background:#000"></div></div>
          <form class="bottle-scan-manual">
            <input placeholder="F000185"/>
            <button type="submit">Abrir</button>
          </form>
          <button type="button" class="bottle-scan-cancel">Cancelar</button>
        </div>
      </div>
    </article>
  </div>
</div>
`

const WIDTHS = [320, 375, 390, 430, 768]

for (const width of WIDTHS) {
  test(`Fase 1 — bottle scan checklist UI @ ${width}px: zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.addStyleTag({ content: 'body{display:flex;flex-direction:column;gap:16px}.page{margin:0;max-width:none}.premium-checklist article{display:block}' })

    for (const fixture of ['checklist-untriggered', 'checklist-assigned', 'checklist-panel-open']) {
      const root = page.locator(`[data-fixture="${fixture}"]`)
      await expect(root).toBeVisible()
      const result = await root.evaluate((el, viewport) => {
        const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
          .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
          .map((node) => node.className)
        const smallTargets = [...el.querySelectorAll<HTMLElement>('button,input')]
          .filter((node) => getComputedStyle(node).display !== 'none')
          .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() || node.getAttribute('placeholder') }))
          .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
          .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
        return { overflowing, smallTargets }
      }, width)
      expect(result.overflowing, `${fixture}@${width}: overflow: ${result.overflowing.join(', ')}`).toEqual([])
      expect(result.smallTargets, `${fixture}@${width}: touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (width === 390) await page.screenshot({ path: 'tests/screenshots/phase1-bottle-separation-390.png', fullPage: true })
  })
}
