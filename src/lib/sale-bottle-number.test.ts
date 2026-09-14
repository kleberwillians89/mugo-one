import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const davi=readFileSync(new URL('../pages/DaviExcelPage.tsx',import.meta.url),'utf8')
const newRows=readFileSync(new URL('../components/DaviExcelNewRows.tsx',import.meta.url),'utf8')
const migration=readFileSync(new URL('../../supabase/migrations/202609110002_sale_bottle_number.sql',import.meta.url),'utf8')

describe('número do frasco por venda',()=>{
  it('é obrigatório em novas vendas do Davi e salvo em formato canônico',()=>{
    expect(newRows).toContain('Informe um número de frasco válido.')
    expect(records).toContain('bottle_identifier:input.bottleNumber?`FRASCO ${input.bottleNumber}`:null')
    expect(records).toContain("rpc('davi_excel_create_sale_with_bottle'")
  })
  it('aparece, pode ser editado e é exportado na planilha Davi',()=>{
    expect(davi).toContain("label:'FRASCO'")
    expect(davi).toContain("'FRASCO':row.bottle_identifier")
    expect(davi).toContain('next.bottle_identifier=')
  })
  it('a importação IA persiste o frasco sem criar identidade física',()=>{
    expect(migration).toContain('bottle_identifier=bottle')
    expect(migration).not.toContain('insert into public.inventory_bottles')
  })
})
