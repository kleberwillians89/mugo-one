import {expect,test,type Page} from '@playwright/test'

/**
 * Reproduces the real production bug: browser window stays wide (DevTools
 * docked, split screen, a future side panel) but the actual USABLE content
 * area shrinks well below the raw viewport width. The fixed 248px sidebar
 * means content width = viewport width - 248px on desktop, so testing a
 * range of container widths directly (independent of viewport) is the most
 * direct way to prove the heroes respond to real available space rather
 * than vw units that don't know the sidebar exists.
 */
const styleFiles = ['src/styles/tokens.css','src/styles.css','src/components/ui/Button.css','src/pages/SaleDetailsPage.css','src/pages/ClientDetailsPage.css','src/enhancements.css','src/styles/rebrand-v2.css']

const saleHero = `<header class="ficha-head surface-dark" data-fixture="venda"><span class="ficha-eyebrow">VENDA</span><h1 class="ficha-client" data-surface-role="primary">DUDA LAZZARINI</h1><p class="ficha-product" data-surface-role="secondary">SISSA - MIND GAMES (FRASCO 2) · 50 ml · APC</p><div class="ficha-price-row"><strong data-surface-role="metric">R$ 1.395,00</strong><span class="badge unknown">DESCONHECIDO</span></div><div class="ficha-actions"><button class="ui-btn ui-btn--secondary"><span>Ver cliente</span></button><button class="ui-btn ui-btn--primary"><span>Confirmar produto</span></button></div></header>`
const clientHero = `<header class="dossier-head surface-dark" data-fixture="cliente"><span class="dossier-eyebrow">CLIENTE</span><h1 class="dossier-name" data-surface-role="primary">TATIANA CARVALHO DE ALBUQUERQUE</h1><p class="dossier-since" data-surface-role="secondary">Cliente desde Março de 2026</p><div class="dossier-stats"><div><strong data-surface-role="metric">89</strong><span>compras</span></div><div><strong data-surface-role="metric">R$ 49.128,70</strong><span>comprados</span></div><div><strong data-surface-role="metric">1.430</strong><span>ml</span></div></div><div class="dossier-actions"><button class="ui-btn ui-btn--secondary"><span>Editar cadastro</span></button><span class="badge paid">ATIVO</span></div></header>`
const shipmentHero = `<header class="shipment-premium-head surface-dark" data-fixture="envio"><div class="ruah-brand"></div><div class="shipment-title"><span>ENVIO 360</span><h1 data-surface-role="primary">CLIENTE RUAH COM NOME OPERACIONAL LONGO</h1><p data-surface-role="secondary">Envio #90FBE65F · 13/08/2026</p></div><div class="shipment-status"><i></i><div><span>Status atual</span><strong>Pronto para calcular frete</strong></div></div></header>`
const labelHero = `<header class="label-atelier-head surface-dark" data-fixture="etiqueta"><div></div><div><span>ETIQUETA DE ENVIO</span><p>Envio #90FBE65F</p><h2 data-surface-role="primary">CLIENTE RUAH COM NOME LONGO</h2></div><strong>ETIQUETA CRIADA</strong></header>`

const pageMarkup = (containerWidth: number) =>
  `<div style="width:${containerWidth}px;border:1px dashed #ccc">
    <div class="page sale-360">${saleHero}</div>
    <div class="page client-360" style="margin-top:40px">${clientHero}</div>
    <div class="page shipment-360" style="margin-top:40px"><section>${shipmentHero}</section></div>
    <div class="page" style="margin-top:40px"><section class="label-atelier surface-dark">${labelHero}</section></div>
  </div>`

async function setup(page: Page, containerWidth: number, viewportWidth = 1600) {
  await page.setViewportSize({ width: viewportWidth, height: 1400 })
  await page.goto('/login')
  await page.setContent(pageMarkup(containerWidth))
  for (const file of styleFiles) await page.addStyleTag({ path: file })
}

const rectsOverlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

const containerWidths = [650, 768, 820, 900, 960, 1024]

for (const width of containerWidths) {
  test(`Venda 360 hero reorganiza sem overlap em container de ${width}px`, async ({ page }) => {
    await setup(page, width)
    const hero = page.locator('[data-fixture="venda"]')
    await expect(hero).toBeVisible()

    // Nome legível: nunca cortado no meio da palavra por falta de espaço.
    const nameOverflow = await hero.locator('.ficha-client').evaluate(node => node.scrollWidth - node.clientWidth)
    expect(nameOverflow).toBeLessThanOrEqual(1)
    await expect(hero.locator('.ficha-client')).toHaveText('DUDA LAZZARINI')

    // Preço inteiro, nunca quebrado/cortado.
    const priceEl = hero.locator('.ficha-price-row strong')
    await expect(priceEl).toHaveText('R$ 1.395,00')
    const priceOverflow = await priceEl.evaluate(node => node.scrollWidth - node.clientWidth)
    expect(priceOverflow).toBeLessThanOrEqual(1)

    // Botões visíveis com touch target mínimo de 44px.
    const buttons = hero.locator('.ficha-actions button')
    for (const button of await buttons.all()) {
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    // Bounding-box overlap: nenhum par de regiões-chave pode se sobrepor.
    const regions = await hero.evaluate(node => {
      const pick = (sel: string) => node.querySelector(sel)?.getBoundingClientRect()
      return {
        name: pick('.ficha-client'),
        product: pick('.ficha-product'),
        price: pick('.ficha-price-row strong'),
        status: pick('.ficha-price-row .badge'),
        actions: pick('.ficha-actions'),
      }
    })
    const entries = Object.entries(regions).filter(([, box]) => box) as [string, DOMRect][]
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++)
        expect(rectsOverlap(entries[i][1], entries[j][1]), `${entries[i][0]} x ${entries[j][0]}`).toBe(false)

    // Zero scroll horizontal no container.
    const containerOverflow = await page.locator('.sale-360').evaluate(node => node.scrollWidth - node.clientWidth)
    expect(containerOverflow).toBeLessThanOrEqual(1)
  })
}

for (const width of containerWidths) {
  test(`Cliente 360 / Envio 360 / Etiqueta permanecem legíveis em container de ${width}px`, async ({ page }) => {
    await setup(page, width)
    for (const fixture of ['cliente', 'envio', 'etiqueta']) {
      const hero = page.locator(`[data-fixture="${fixture}"]`)
      await expect(hero).toBeVisible()
      const overflow = await hero.evaluate(node => node.scrollWidth - node.clientWidth)
      expect(overflow, fixture).toBeLessThanOrEqual(1)
    }
    for (const text of ['TATIANA CARVALHO DE ALBUQUERQUE', 'CLIENTE RUAH COM NOME OPERACIONAL LONGO', 'CLIENTE RUAH COM NOME LONGO'])
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
  })
}

const viewportWidths = [390, 768, 1024, 1280, 1440]
for (const width of viewportWidths) {
  test(`Venda 360 hero: viewport ${width}px, zero overflow de documento`, async ({ page }) => {
    await setup(page, width - 248 > 320 ? width - 248 : width, width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}

for (const zoom of [1.1, 1.25, 1.5]) {
  test(`Venda 360 hero preserva composição a ${Math.round(zoom * 100)}% de zoom`, async ({ page }) => {
    const effectiveViewport = Math.floor(1280 / zoom)
    await setup(page, Math.max(effectiveViewport - 248, 320), effectiveViewport)
    const hero = page.locator('[data-fixture="venda"]')
    await expect(hero).toBeVisible()
    const overflow = await hero.evaluate(node => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}

test('screenshots sanitizados: Venda 360 / Cliente 360 / Envio 360 em container reduzido e amplo', async ({ page }) => {
  for (const width of [390, 768, 900, 1024, 1280, 1440]) {
    await setup(page, width > 760 ? width - 248 : width, width)
    await page.locator('[data-fixture="venda"]').screenshot({ path: `tests/screenshots/venda360-${width}.png` })
  }
  for (const width of [390, 900, 1440]) {
    await setup(page, width > 760 ? width - 248 : width, width)
    await page.locator('[data-fixture="cliente"]').screenshot({ path: `tests/screenshots/cliente360-${width}.png` })
    await page.locator('[data-fixture="envio"]').screenshot({ path: `tests/screenshots/envio360-${width}.png` })
  }
})
