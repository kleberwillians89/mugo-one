import { test, expect } from '@playwright/test'

/**
 * Responsive smoke coverage for the one screen reachable without a real
 * Supabase session: the login shell. Authenticated pages (Cliente 360,
 * Venda 360, Envio 360, etc.) need real test credentials this environment
 * doesn't have — see docs/UX_AUDIT.md for the manual-QA checklist covering
 * those routes instead.
 */
const widths = [320, 375, 390, 430, 768, 1024, 1280, 1440]

for (const width of widths) {
  test(`login screen has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `tests/screenshots/login-${width}.png`, fullPage: true })
  })
}
