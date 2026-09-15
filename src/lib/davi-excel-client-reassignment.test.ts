import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const combo=readFileSync('src/components/ui/EntityCombobox.tsx','utf8')
const rpc=readFileSync('supabase/migrations/202608230008_davi_excel_safe_existing_sale_update.sql','utf8')

describe('troca de cliente em venda salva no Davi Excel',()=>{
 it('permite apagar o valor controlado e pesquisar outra cliente',()=>{
  expect(combo).toContain('[editing,setEditing]=useState(false)')
  expect(combo).toContain('value={editing?query:value?.label??query}')
  expect(combo).toContain('setEditing(true);setQuery(next)')
  expect(combo).toContain("if((value&&!editing)||term.length<minimumCharacters)return")
 })
 it('exige selecionar uma cliente válida antes de salvar',()=>{
  expect(page).toContain("if(!draft.client){setError('Selecione a cliente correta na lista.')")
  expect(page).toContain('next.client_id=draft.client.id')
 })
 it('backend aceita client_id e atualiza o nome bruto com auditoria',()=>{
  expect(rpc).toContain("allowed constant text[]:=array['client_id'")
  expect(rpc).toContain("client_name_raw=case when p_patch?'client_id' then next_client.name")
  expect(rpc).toContain("'davi_excel_sale_updated'")
 })
})
