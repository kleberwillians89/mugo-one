import{expect,test,type Page}from'@playwright/test'

const markup=`<div class="page davi-excel"><section class="davi-toolbar"><div class="davi-toolbar-filters"><label><input placeholder="Buscar cliente, perfume ou referência"></label><label class="davi-split-filter">SPLIT<select><option>TODOS</option></select></label><label class="davi-gift-filter">BRINDE<select><option>TODOS</option></select></label><label class="davi-attachment-filter">COMPROVANTE<select><option>TODOS</option></select></label></div><div class="davi-toolbar-meta"><span>8.629 resultados · Página 1 de 87</span><button>LIMPAR FILTROS</button><button>LIMPAR CLASSIFICAÇÃO</button></div></section></div>`
async function setup(page:Page,width:number){await page.setViewportSize({width,height:500});await page.goto('/login');await page.setContent(markup);await page.addStyleTag({path:'src/pages/DaviExcelPage.css'})}

const widths=[1366,1440,1512,1920]
for(const width of widths)test(`toolbar do Davi Excel sem overlap ou corte em ${width}px`,async({page})=>{
 await setup(page,width)
 const toolbar=page.locator('.davi-toolbar')
 const overflowH=await toolbar.evaluate(node=>node.scrollWidth>node.clientWidth+1)
 expect(overflowH).toBe(false)
 const overlaps=await page.evaluate(()=>{
  const nodes=[...document.querySelectorAll('.davi-toolbar label,.davi-toolbar span,.davi-toolbar button')]
  const rects=nodes.map(node=>node.getBoundingClientRect())
  const pairs:number[][]=[]
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
   const a=rects[i],b=rects[j]
   const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left)
   const overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)
   if(overlapX>1&&overlapY>1)pairs.push([i,j])
  }
  return pairs
 })
 expect(overlaps).toEqual([])
 for(const button of await page.locator('.davi-toolbar-meta button').all()){
  expect(await button.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap')
  expect(await button.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
 }
 const resultsSpan=page.locator('.davi-toolbar-meta span')
 expect(await resultsSpan.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap')
 expect(await resultsSpan.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
})

test('busca cresce e selects não encolhem abaixo do conteúdo',async({page})=>{
 await setup(page,1920)
 const searchLabel=page.locator('.davi-toolbar-filters label').first()
 const splitLabel=page.locator('.davi-toolbar-filters label.davi-split-filter')
 expect(await searchLabel.evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(400)
 expect(await splitLabel.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
})

test('estrutura separa filtros e meta em containers próprios',async({page})=>{
 await setup(page,1440)
 expect(await page.locator('.davi-toolbar-filters').count()).toBe(1)
 expect(await page.locator('.davi-toolbar-meta').count()).toBe(1)
 expect(await page.locator('.davi-toolbar-filters label').count()).toBe(4)
 expect(await page.locator('.davi-toolbar-meta button').count()).toBe(2)
})

test('em janela mais estreita a linha de meta pode quebrar para uma segunda linha sem overlap ou corte',async({page})=>{
 await setup(page,760)
 const toolbar=page.locator('.davi-toolbar')
 expect(await toolbar.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(false)
})
