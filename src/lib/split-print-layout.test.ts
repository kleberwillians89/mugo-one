import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const page=readFileSync('src/legacy/operations/pages/SplitsDoDiaPrintPage.tsx','utf8')
const css=readFileSync('src/legacy/operations/pages/SplitsDoDiaPrintPage.css','utf8')

describe('layout paginável da folha de splits',()=>{
 it('imprime os itens em tabela agrupada por cliente',()=>{
  expect(page).toContain('className="splits-document-table"')
  expect(page).toContain('className="splits-client-row"')
  expect(page).toContain('className="splits-item-row"')
  expect(page).toContain('group.items.map')
 })
 it('permite repetição do cabeçalho e paginação entre linhas',()=>{
  expect(css).toContain('.splits-document-table thead { display: table-header-group; }')
  expect(css).toContain('page-break-inside: avoid')
  expect(css).toContain('.splits-client-row { break-after: avoid; page-break-after: avoid; }')
 })
 it('neutraliza largura, altura e overflow herdados do shell no PDF',()=>{
  expect(css).toContain('width: 100% !important')
  expect(css).toContain('height: auto !important')
  expect(css).toContain('overflow: visible !important')
  expect(css).toContain('.splits-document-header { display: flex !important; position: static !important;')
 })
})
