import {expect,test} from '@playwright/test'

const saleCards=Array.from({length:162},(_,i)=>{const n=String(i+1).padStart(3,'0');return `<article class="batch-sale" id="sale-${i}"><b>${n}</b><div><strong>Cliente ${n}</strong><small>Pagamento: aguardando confirmação</small></div><label><span>CLIENTE NO CRM</span><select><option>Cliente ${n}</option></select></label></article>`}).join('')
const markup=`<div class="ai-batch-layer"><div class="ai-batch-scroll" id="scroll-root"><section class="ai-batch-assistant"><header id="import-header"><div><span>RUAH · ASSISTENTE OPERACIONAL</span><h2>Importar lista com IA</h2><p>A IA interpreta. Você revisa. O CRM só grava depois da confirmação.</p></div><button aria-label="Fechar">×</button></header><div class="ai-batch-preview"><section class="batch-overview"><div><span>IMPORTAÇÃO COM VÁRIOS LOTES</span><h3>1 perfume encontrado</h3><p>162 vendas · 500 ml · R$ 41.507,70</p></div><div><strong>1</strong><span>lotes</span><strong>162</strong><span>vendas</span><strong>500 ml</strong><span>volume</span></div></section><section><h4>CLIENTES E VENDAS</h4>${saleCards}</section><footer><p>Serão criadas 162 vendas pendentes.</p><button>VOLTAR</button><button class="primary">CRIAR 162 VENDAS</button></footer></div></section></div></div>`

test('lista longa (162 vendas): estrutura de scroll não sobrepõe conteúdo com faixa fixa',async({page})=>{
  await page.setViewportSize({width:1024,height:800});await page.goto('/login');await page.setContent(markup)
  for(const file of ['src/styles/tokens.css','src/styles.css','src/enhancements.css','src/styles/rebrand-v2.css'])await page.addStyleTag({path:file})

  const layerOverflow=await page.locator('.ai-batch-layer').evaluate(node=>getComputedStyle(node).overflowY)
  expect(layerOverflow).not.toBe('auto')
  expect(layerOverflow).not.toBe('scroll')
  const scrollOverflow=await page.locator('.ai-batch-scroll').evaluate(node=>getComputedStyle(node).overflowY)
  expect(['auto','scroll']).toContain(scrollOverflow)

  await page.locator('#scroll-root').evaluate(node=>node.scrollTo(0,node.scrollHeight/2))

  const headerGone=await page.locator('#import-header').evaluate(node=>node.getBoundingClientRect().bottom<=0)
  expect(headerGone).toBe(true)

  const midCard=page.locator('#sale-80')
  await expect(midCard).toBeInViewport()
  const covered=await midCard.evaluate(node=>{
    const box=node.getBoundingClientRect(),x=box.left+10,y=box.top+box.height/2
    const top=document.elementFromPoint(x,y)
    return !!top && (node===top || node.contains(top))
  })
  expect(covered).toBe(true)

  await page.locator('#scroll-root').evaluate(node=>node.scrollTo(0,node.scrollHeight))
  const lastCard=page.locator('#sale-161')
  await expect(lastCard).toBeInViewport()
})
