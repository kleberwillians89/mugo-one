import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'
const css=readFileSync('src/pages/DaviExcelPage.css','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
describe('Davi Excel visual pass 2',()=>{
 it('libera a página ao lado da sidebar e faz a tabela dominar a área',()=>{
  expect(css).toContain('.app-shell>main:has(.davi-excel) .page.davi-excel{width:100%;max-width:none')
  expect(css).toContain('.davi-grid{height:calc(100dvh - 245px);max-height:none')
 })
 it('usa toolbar premium, linhas confortáveis e paginação integrada',()=>{
  expect(css).toContain('border-radius:8px;background:var(--davi-paper)')
  expect(css).toContain('height:48px;padding:7px 12px;border-right:0')
  expect(css).toContain('.davi-pages{min-height:58px')
 })
 it('mantém sticky de cliente e ações com largura fixa',()=>{
  expect(css).toContain('.davi-grid th:nth-child(2),.davi-grid td:nth-child(2){background:var(--davi-surface)')
  expect(css).toContain('.davi-grid .davi-row-actions,.davi-grid .davi-actions-header{width:64px')
  expect(page).toContain('className="davi-actions-header">AÇÕES')
 })
 it('não deixa menu contextual preso ao overflow da tabela',()=>{
  expect(page).toContain('createPortal(<div className="davi-action-menu"')
  expect(css).toContain('.davi-action-menu{position:fixed;top:auto;right:auto;z-index:1000}')
 })
})
