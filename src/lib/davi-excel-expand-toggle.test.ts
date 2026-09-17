import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
const page=readFileSync('src/legacy/spreadsheet/DaviExcelPage.tsx','utf8')
const polishCss=readFileSync('src/legacy/spreadsheet/DaviExcelPolish.css','utf8')
const pageCss=readFileSync('src/legacy/spreadsheet/DaviExcelPage.css','utf8')

describe('expandir/recolher planilha do Davi Excel',()=>{
 it('usa um único estado de expansão, sem estado independente duplicado',()=>{
  expect(page.match(/\[expanded,setExpanded\]=useState\(false\)/g)).toHaveLength(1)
  expect(page.match(/expanded/g)?.length).toBeGreaterThan(0)
 })
 it('estado inicial do botão mostra EXPANDIR PLANILHA',()=>{
  expect(page).toContain("expanded?'RECOLHER PLANILHA':'EXPANDIR PLANILHA'")
 })
 it('o mesmo botão alterna: clique expande e o clique seguinte recolhe',()=>{
  expect(page.match(/onClick=\{\(\)=>setExpanded\(value=>!value\)\}/g)).toHaveLength(1)
 })
 it('expandido, o botão mostra RECOLHER PLANILHA',()=>{
  expect(page).toContain('{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>} {expanded?\'RECOLHER PLANILHA\'')
 })
 it('ESC aciona exatamente o mesmo setter de recolhimento usado pelo botão',()=>{
  expect(page).toMatch(/if\(!expanded\)return;const onKey=\(event:KeyboardEvent\)=>\{if\(event\.key==='Escape'\)setExpanded\(false\)\}/)
  expect(page.match(/setExpanded\(/g)?.length).toBe(2)
 })
 it('CSS não esconde o cabeçalho/controle no modo expandido',()=>{
  expect(polishCss).not.toContain('.davi-excel.expanded .davi-title{display:none}')
  expect(polishCss).not.toMatch(/\.davi-excel\.expanded \.davi-actions\{[^}]*display:none/)
  expect(pageCss).not.toMatch(/\.davi-excel\.expanded \.davi-title\{[^}]*display:none/)
 })
 it('mantém sidebar/layout e header globais controlados apenas por davi-sheet-mode, sem remontar a grid',()=>{
  expect(page).toContain("classList.toggle('davi-sheet-mode',expanded)")
  expect(page).not.toMatch(/key=\{expanded/)
 })
})
