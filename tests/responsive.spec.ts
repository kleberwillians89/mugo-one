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

for (const zoom of [1,1.1,1.25]) {
  test(`login preserves controls and copy at ${Math.round(zoom*100)}% zoom`,async({page})=>{
    await page.setViewportSize({width:Math.floor(430/zoom),height:900})
    await page.goto('/login')
    const audit=await page.evaluate(()=>{
      const viewport=document.documentElement.clientWidth
      const interactive=[...document.querySelectorAll<HTMLElement>('button,input:not([type=checkbox]),select,textarea')].filter(node=>getComputedStyle(node).display!=='none')
      const outside=[...document.querySelectorAll<HTMLElement>('body *')].filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&(box.left<-.5||box.right>viewport+.5)})
      const clipped=[...document.querySelectorAll<HTMLElement>('h1,h2,h3,p,button,label,span')].filter(node=>node.scrollWidth>node.clientWidth+1&&getComputedStyle(node).overflow==='hidden')
      const small=interactive.filter(node=>{const box=node.getBoundingClientRect();return box.width<44||box.height<44})
      return{outside:outside.length,clipped:clipped.length,smallTargets:small.length,smallDetails:small.map(node=>{const box=node.getBoundingClientRect();return`${node.tagName}:${node.getAttribute('aria-label')||node.textContent?.trim()||node.getAttribute('type')} ${Math.round(box.width)}x${Math.round(box.height)}`})}
    })
    expect(audit.outside).toBe(0)
    expect(audit.clipped).toBe(0)
    expect(audit.smallTargets,audit.smallDetails.join(', ')).toBe(0)
  })
}
