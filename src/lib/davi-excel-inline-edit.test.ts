import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const page=readFileSync('src/legacy/spreadsheet/DaviExcelPage.tsx','utf8')
const migration=readFileSync('supabase/migrations/202609150002_fix_vanilla_baby_client.sql','utf8')

describe('edição direta no Davi Excel',()=>{
 it('abre a linha por duplo clique, teclado ou botão visível',()=>{
  expect(page).toContain('onDoubleClick={event=>')
  expect(page).toContain("event.key==='Enter'")
  expect(page).toContain('className="davi-inline-edit"')
  expect(page).toContain('Dê dois cliques em qualquer célula para editar')
 })
 it('mantém a troca de cliente pelo combobox e o salvamento auditado existente',()=>{
  expect(page).toContain('label="Cliente"')
  expect(page).toContain('next.client_id=draft.client.id')
  expect(page).toContain('updateDaviExcelSale(row.id,next,source.updated_at')
 })
 it('corrige somente o registro exato de VANILLA BABY e registra auditoria',()=>{
  expect(migration).toContain("id='ea1808b3-062b-4d74-8e43-3c45929b369b'::uuid")
  expect(migration).toContain("id='605e0451-f3dc-4325-8a2b-73d92dc90f84'::uuid")
  expect(migration).toContain("'sale_client_corrected'")
  expect(migration).toContain("'before_client_name','DANIELA BETETO'")
  expect(migration).toContain("'after_client_name',v_client.name")
 })
})
