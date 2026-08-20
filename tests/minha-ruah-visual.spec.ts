import { expect, test } from '@playwright/test'

const widths = [320,360,375,390,430,768,1024,1440]

for (const width of widths) test(`Minha RUAH public experience @ ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000})
  for (const route of ['/minha-ruah/login','/minha-ruah/cadastro','/minha-ruah/recuperar','/minha-ruah/ativar-conta']) {
    await page.goto(route)
    await expect(page.locator('.portal-auth-card')).toBeVisible()
    const audit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,small:[...document.querySelectorAll<HTMLElement>('button,input')].filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&(box.width<44||box.height<44)}).map(node=>node.getAttribute('aria-label')||node.textContent?.trim()||node.tagName)}))
    expect(audit.overflow).toBeLessThanOrEqual(1)
    expect(audit.small).toEqual([])
    const name=route.split('/').pop()||'login'
    await page.screenshot({path:`tests/screenshots/minha-ruah-${name}-${width}.png`,fullPage:true})
  }
})
