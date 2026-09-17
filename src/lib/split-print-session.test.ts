import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const auth=readFileSync('src/Auth.tsx','utf8')
const queue=readFileSync('src/legacy/operations/pages/FaltaSplitarPage.tsx','utf8')
const print=readFileSync('src/legacy/operations/pages/SplitsDoDiaPrintPage.tsx','utf8')

describe('sessão da folha de splits',()=>{
 it('transfere a sessão temporária antes de navegar a nova aba',()=>{
  expect(queue).toContain("const printWindow=window.open('','_blank')")
  expect(queue).toContain("printWindow.sessionStorage.setItem('mugo_one_session','active')")
  expect(queue).toContain('printWindow.location.assign(href)')
 })
 it('aceita somente popup de impressão aberto pela mesma origem',()=>{
  expect(auth).toContain("initialPath.startsWith('/print/')")
  expect(auth).toContain('window.opener?.location.origin===location.origin')
  expect(auth).toContain("sessionStorage.setItem(SESSION_KEY,'active')")
 })
 it('não imprime documento vazio quando os ids não retornam itens',()=>{
  expect(print).toContain('if(!items.length)')
  expect(print).toContain('Nenhum item da seleção foi encontrado')
 })
})
