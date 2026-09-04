import{expect,test}from'@playwright/test'

const markup=`<main class="shipment-document-page"><style>@page { size: A4 portrait; margin: 12mm 14mm; }</style><article class="shipment-document"><header class="shipment-document-header"><div class="shipment-document-brand"><strong>RUAH</strong><span>PARFUMS</span></div><div><span>DOCUMENTO OPERACIONAL</span><h1>NOTA DE ENVIO</h1><dl><div><dt>Referência</dt><dd>ENVIO 12D3F0A6</dd></div><div><dt>Preparação / impressão</dt><dd>23/08/2026</dd></div><div><dt>Status</dt><dd>Aguardando aprovação da cliente</dd></div></dl></div></header><section class="shipment-document-destination"><h2>Cliente e destino</h2><div class="shipment-document-grid"><div><small>CLIENTE</small><strong>Ilde mae</strong><span>(11) 99999-0000</span></div><div><small>DESTINATÁRIO</small><strong>Ilde mae</strong></div><address><small>ENDEREÇO DO ENVIO</small><strong>Rua correta, 199</strong><span>Bairro: Centro</span><span>Centro · São Paulo / SP</span><span>CEP 05616-080</span></address></div></section><section class="shipment-document-logistics"><h2>Status e logística</h2><dl><div><dt>Status</dt><dd>Aguardando aprovação da cliente</dd></div><div><dt>Transportadora</dt><dd>loggi</dd></div><div><dt>Serviço</dt><dd>LOGGI</dd></div><div><dt>Frete</dt><dd>R$ 9,36</dd></div><div><dt>Rastreio</dt><dd>Ainda não emitido</dd></div></dl></section><section class="shipment-document-items"><h2>Itens para conferência</h2><table><thead><tr><th>Conferência</th><th>Perfume</th><th>ML</th></tr></thead><tbody><tr><td><span class="shipment-check-box"></span></td><td>ambre crush</td><td>100 ml</td></tr></tbody></table></section><section class="shipment-document-summary"><div><h2>Resumo</h2><dl><div><dt>Itens</dt><dd>1</dd></div><div><dt>Total</dt><dd>100 ml</dd></div><div><dt>Frete</dt><dd>R$ 9,36</dd></div></dl></div><div><h2>Conferência final</h2><ul><li><span class="shipment-check-box"></span>Todos os perfumes conferidos</li><li><span class="shipment-check-box"></span>Embalagem conferida</li></ul></div></section><section class="shipment-document-notes"><h2>Observações do envio</h2><p>Manter caixa na vertical.</p></section><section class="shipment-document-signature"><div><span>Separado por</span></div><div><span>Conferido por</span></div><div><span>Data / hora</span></div></section><footer><span>RUAH Parfums</span><small>Documento operacional para separação e conferência. Não é documento fiscal.</small></footer></article></main>`

// Mesma ordem de import de src/main.tsx — carregar só ShipmentPrintPage.css
// (como o teste fazia antes) deixa passar qualquer regra global de tag
// (<header>, <main>, <dl>...) que vaze para dentro deste documento isolado.
// Foi exatamente essa lacuna que permitiu a regressão de A4 chegar à
// produção sem ser pega por este teste.
const globalCssFiles=['src/styles/tokens.css','src/styles.css','src/enhancements.css','src/auth.css','src/mugo.css','src/styles/rebrand-v2.css','src/pages/ShipmentPrintPage.css']

async function setup(page:import('@playwright/test').Page){
 await page.goto('/login')
 await page.setContent(`<div id="root">${markup}</div>`)
 for(const file of globalCssFiles)await page.addStyleTag({path:file})
 await page.emulateMedia({media:'print'})
}

test('nota P0 realista cabe em uma A4 sem overlap nem segunda página, com o bundle global real de CSS',async({page})=>{
 await setup(page)
 const boxes=await page.locator('.shipment-document>header,.shipment-document>section,.shipment-document>footer').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return{top:box.top,bottom:box.bottom}}))
 expect(boxes.length).toBe(8)
 for(let index=1;index<boxes.length;index++)expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index-1].bottom-1)
 const printGeometry=await page.locator('.shipment-document').evaluate(node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return{width:box.width,height:box.height,transform:style.transform,zoom:style.zoom,overflow:style.overflow}})
 expect(printGeometry.width).toBeGreaterThan(650)
 expect(printGeometry.height).toBeLessThan(1040)
 expect(printGeometry).toMatchObject({transform:'none',zoom:'1',overflow:'visible'})
 expect(await page.locator('.shipment-document').innerText()).not.toContain('Julia')
 const pdf=await page.pdf({format:'A4',printBackground:true,displayHeaderFooter:false})
 const raw=pdf.toString('latin1')
 expect((raw.match(/\/Type\s*\/Page\b/g)??[])).toHaveLength(1)
 expect(raw).toMatch(/\/MediaBox\s*\[0\s+0\s+59[45]\.[0-9]+\s+84[12]\.[0-9]+\]/)
})

test('nenhuma seção do corpo desaparece ou fica com dimensão zero sob o bundle global real de CSS',async({page})=>{
 await setup(page)
 // Um PDF "vazio" com só o título (a regressão real) teria a maioria destas
 // seções ausentes ou com height/width 0 — este teste falha nesse cenário.
 const sections=['.shipment-document-header','.shipment-document-brand','.shipment-document-header dl','.shipment-document-destination','.shipment-document-logistics','.shipment-document-items','.shipment-document-summary','.shipment-document-notes','.shipment-document-signature','.shipment-document>footer']
 for(const selector of sections){
  const box=await page.locator(selector).evaluate(node=>node.getBoundingClientRect())
  expect(box.width,`${selector} deve ter largura > 0`).toBeGreaterThan(0)
  expect(box.height,`${selector} deve ter altura > 0`).toBeGreaterThan(0)
 }
 const computed=await page.evaluate(selectors=>selectors.map(selector=>{
  const node=document.querySelector(selector) as HTMLElement
  const style=getComputedStyle(node)
  return{selector,display:style.display,visibility:style.visibility,position:style.position}
 }),sections)
 for(const item of computed){
  expect(item.display,`${item.selector} não pode estar display:none`).not.toBe('none')
  expect(item.visibility,`${item.selector} não pode estar visibility:hidden`).not.toBe('hidden')
  expect(item.position,`${item.selector} não pode herdar position:sticky/fixed/absolute de uma regra global`).toBe('static')
 }
})

test('cliente, perfume, endereço e frete aparecem no texto final do documento',async({page})=>{
 await setup(page)
 const text=await page.locator('.shipment-document').innerText()
 expect(text).toContain('Ilde mae')
 expect(text).toContain('ambre crush')
 expect(text).toContain('Rua correta, 199')
 expect(text).toContain('R$ 9,36')
 expect(text).toContain('CLIENTE E DESTINO')
 expect(text).toContain('STATUS E LOGÍSTICA')
 expect(text).toContain('ITENS PARA CONFERÊNCIA')
 expect(text).toContain('RESUMO')
 expect(text).toContain('CONFERÊNCIA FINAL')
 expect(text).toContain('Separado por')
 expect(text).toContain('Conferido por')
})

test('o cabeçalho real de <header> não herda position:sticky da barra do app shell',async({page})=>{
 await setup(page)
 const header=await page.locator('.shipment-document-header').evaluate(node=>{const style=getComputedStyle(node);return{position:style.position,top:style.top}})
 expect(header.position).toBe('static')
})
