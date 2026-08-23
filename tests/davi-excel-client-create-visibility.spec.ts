import { expect, test, type Page } from '@playwright/test'

const clients=Array.from({length:24},(_,index)=>`<button role="option">Ilde sugestão ${index+1}</button>`).join('')
const markup=`<div class="davi-grid"><table><tbody class="davi-drafts-body"><tr class="davi-new-row"><td><div class="entity-combobox"><div class="entity-combobox-popover entity-combobox-popover--create-top"><div role="listbox"><button class="entity-combobox-create active" role="option">+ <strong>CADASTRAR “ILDE MAE”</strong></button><div class="entity-combobox-results" role="presentation">${clients}</div></div></div></div></td><td>linha da planilha</td></tr></tbody></table></div>`

async function setup(page:Page,width:number){
  await page.setViewportSize({width,height:844})
  await page.goto('/login')
  await page.setContent(markup)
  await page.addStyleTag({path:'src/components/ui/EntityCombobox.css'})
  await page.addStyleTag({content:':root{--line:#ddd;--paper:#fff;--gold:#8c6a24;--ink:#221b12;--muted:#777}.davi-grid{position:relative;overflow:auto;height:500px}.davi-grid table{width:100%;min-width:700px}.davi-new-row td{position:relative;height:32px}.entity-combobox{width:280px}.entity-combobox-popover{display:block;top:0;max-height:320px}'})
}

for(const width of [390,1024,1440])test(`CTA de cliente permanece visível acima de 24 resultados em ${width}px`,async({page})=>{
  await setup(page,width)
  const cta=page.getByRole('option',{name:/CADASTRAR “ILDE MAE”/}),results=page.locator('.entity-combobox-results')
  await expect(cta).toBeVisible()
  expect(await results.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true)
  const before=await cta.boundingBox()
  await results.evaluate(node=>{node.scrollTop=node.scrollHeight})
  const after=await cta.boundingBox()
  expect(after?.y).toBe(before?.y)
  expect((await cta.boundingBox())!.y).toBeLessThan((await page.getByRole('option',{name:'Ilde sugestão 24'}).boundingBox())!.y)
})
