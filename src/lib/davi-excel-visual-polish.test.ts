import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8'),drafts=readFileSync('src/components/DaviExcelNewRows.tsx','utf8'),css=readFileSync('src/components/DaviExcelPolish.css','utf8')+readFileSync('src/components/DaviExcelNewRows.css','utf8')
describe('polimento visual do Davi Excel',()=>{
 it('usa uma única tabela, header e scroll para rascunhos e vendas',()=>{expect(page.match(/className="davi-grid"/g)).toHaveLength(1);expect(page).toContain('</thead>{canEdit&&<DaviExcelNewRows');expect(page).not.toContain('davi-new-rows-shell');expect(drafts).toContain('<tbody')})
 it('oferece barra compacta, botões sem quebra e recolhimento',()=>{expect(drafts).toContain('NOVA LINHA');expect(drafts).toContain('SALVAR {valid');expect(drafts).toContain("collapsed?'MOSTRAR':'RECOLHER'");expect(css).toContain('white-space:nowrap')})
 it('compartilha as larguras canônicas entre th e td',()=>{for(const width of ['190px','110px','125px','85px','65px','300px','135px','165px','120px','100px','260px'])expect(css).toContain(width);expect(css).toContain('.davi-grid th:nth-child(1),.davi-grid td:nth-child(1)')})
 it('mantém header, cliente e data sticky',()=>{expect(css).toContain('.davi-grid thead th{position:sticky');expect(css).toContain('left:190px');expect(css).toContain('.davi-grid th:first-child,.davi-grid td:first-child')})
 it('preserva densidade de planilha e inputs como células',()=>{expect(css).toContain('height:29px');expect(css).toContain('height:25px!important');expect(css).toContain('border:0!important');expect(css).toContain('outline:1.5px')})
 it('usa a altura útil e maximiza o modo expandido',()=>{expect(css).toContain('height:calc(100dvh - 190px)');expect(css).toContain('.davi-excel.expanded .davi-grid{height:calc(100dvh - 74px)');expect(css).toContain('.davi-excel.expanded .davi-title{display:none}')})
})
