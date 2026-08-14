import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const styles=readFileSync(new URL('../styles.css',import.meta.url),'utf8')
const rebrand=readFileSync(new URL('../styles/rebrand-v2.css',import.meta.url),'utf8')

describe('responsividade baseada em container real, não em vw/viewport',()=>{
  it('.page é um container de inline-size nomeado "page", ancorando os @container das heroes',()=>{
    expect(styles).toMatch(/\.page\{[^}]*container-type:inline-size/)
    expect(styles).toMatch(/\.page\{[^}]*container-name:page/)
  })
  it('main e .page têm min-width:0 para não recusar encolher dentro do app-shell',()=>{
    expect(styles).toMatch(/main\{[^}]*min-width:0/)
    expect(styles).toMatch(/\.page\{[^}]*min-width:0/)
  })
  it('heroes usam @container page, não apenas @media de viewport',()=>{
    expect(rebrand).toContain('@container page (max-width:900px)')
    expect(rebrand).toContain('@container page (max-width:650px)')
    expect(rebrand).toContain('@container page (max-width:460px)')
  })
})

describe('root cause: header{} global vazava para as heroes editoriais (<header> semântico)',()=>{
  it('header{} global ainda existe (nav do app) mas display:flex/position:sticky não podem mais vazar para .ficha-head/.dossier-head', ()=>{
    expect(styles).toMatch(/header\{[^}]*display:flex[^}]*position:sticky/)
    expect(rebrand).toMatch(/\.dossier-head,\.ficha-head\{display:block!important;position:static!important/)
  })
  it('shipment-premium-head neutraliza o position:sticky vazado (display já era seguro via display:grid próprio)',()=>{
    expect(rebrand).toContain('.shipment-premium-head{position:static!important}')
  })
  it('shipment-section-title (título de seção, usa <header>) também neutraliza o position:sticky vazado',()=>{
    expect(rebrand).toContain('.shipment-section-title{position:static}')
  })
  it('label-atelier-head já era seguro (display:grid e position:relative próprios) — não precisou de override',()=>{
    const enhancements=readFileSync(new URL('../enhancements.css',import.meta.url),'utf8')
    expect(enhancements).toMatch(/\.label-atelier-head\{position:relative;display:grid/)
  })
})

describe('nome do cliente/título nunca quebra no meio da palavra por um container artificialmente estreito',()=>{
  it('overflow-wrap:anywhere trocado por break-word nos títulos das heroes (word-break normal, nunca break-all)',()=>{
    expect(rebrand).toMatch(/\.dossier-name,\.ficha-client,\.shipment-title h1,\.label-atelier-head h2\{overflow-wrap:break-word;word-break:normal/)
    expect(rebrand).not.toMatch(/\.dossier-name,\.ficha-client[^}]*overflow-wrap:anywhere/)
    expect(rebrand).not.toMatch(/\.dossier-name,\.ficha-client,\.shipment-title h1,\.label-atelier-head h2\{[^}]*break-all/)
  })
})

describe('preço/status/ações reorganizam, não comprimem',()=>{
  it('ações empilham em coluna cheia (100%, min-height 44px) só quando o container real não comporta a linha',()=>{
    expect(rebrand).toMatch(/@container page \(max-width:650px\)\{[\s\S]*?\.ficha-actions\{flex-direction:column;align-items:stretch\}/)
    expect(rebrand).toMatch(/\.ficha-actions>\*\{width:100%;min-height:44px\}/)
  })
  it('preço/badge podem quebrar linha (flex-wrap) em vez de se sobrepor às ações',()=>{
    expect(rebrand).toMatch(/\.ficha-price-row\{flex-wrap:wrap;row-gap:8px\}/)
  })
})
