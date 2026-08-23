import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'
const ui=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const combo=readFileSync('src/components/ui/EntityCombobox.tsx','utf8')

describe('blockers finais do Davi Excel',()=>{
 it('mantém activeCell explícita por linha e coluna',()=>{expect(ui).toContain("type ActiveCell={rowId:string;columnKey:EditableColumn}");expect(ui).toContain('EDITABLE_COLUMNS')})
 it('Enter e Shift Enter navegam verticalmente sem salvar',()=>{expect(ui).toContain("if(event.key==='Enter'){event.preventDefault();moveVertical(row.key,column,event.shiftKey?-1:1)");expect(ui.match(/void save\(row\)/g)).toHaveLength(1)})
 it('Ctrl ou Cmd Enter continua salvando explicitamente',()=>{expect(ui).toContain("(event.ctrlKey||event.metaKey)&&event.key==='Enter'");expect(ui).toContain('void save(row)')})
 it('setas verticais navegam linhas e horizontais navegam colunas',()=>{expect(ui).toContain("event.key==='ArrowUp'||event.key==='ArrowDown'");expect(ui).toContain('moveVertical');expect(ui).toContain("event.key==='ArrowLeft'||event.key==='ArrowRight'");expect(ui).toContain('moveHorizontal')})
 it('preserva cursor e seleção dentro de texto',()=>{expect(ui).toContain('target.selectionStart');expect(ui).toContain('target.selectionEnd');expect(ui).toContain("event.key==='ArrowLeft'&&start>0");expect(ui).toContain("event.key==='ArrowRight'&&end<length")})
 it('autocomplete consome setas, Enter e Escape antes da grade',()=>{for(const key of ['Enter','ArrowUp','ArrowDown','Escape'])expect(ui).toContain(key);expect(ui).toContain('combobox&&popover');expect(combo).toContain("event.key==='Enter'&&open");expect(combo).toContain("event.key==='Escape'")})
 it('Escape restaura o valor local e nunca apaga a linha',()=>{expect(ui).toContain('restoreCell(row,column)');expect(ui).not.toContain("event.key==='Delete'")})
 it('Tab permanece nativo',()=>{expect(ui).not.toContain("event.key==='Tab'")})
 it('paste 21 abre revisão e paste 20 permanece inline',()=>{expect(ui).toContain('if(rows.length>20){setReview({rows});return}');expect(ui).toContain('setDrafts(current=>')})
 it('revisão mostra contagens, ambiguidades e opção de ignorar',()=>{for(const label of ['Linhas válidas','Linhas inválidas','Clientes não encontrados','Clientes ambíguos','Perfumes não encontrados','Perfumes ambíguos','Datas inválidas','Valores inválidos','ML inválidos','IGNORAR LINHA'])expect(ui).toContain(label)})
 it('revisão só adiciona rascunhos e nunca chama persistência',()=>{const accept=ui.slice(ui.indexOf('const acceptDrafts'),ui.indexOf('const paste='));expect(accept).toContain('setDrafts');expect(accept).not.toContain('createSale');expect(accept).not.toContain('save(');expect(ui).toContain('Nada foi salvo ainda.')})
 it('modal acessível possui cancelamento e usa o focus trap canônico',()=>{expect(ui).toContain('<Modal open={Boolean(review)}');expect(ui).toContain('onClose={onCancel}');expect(ui).toContain('CANCELAR')})
})
