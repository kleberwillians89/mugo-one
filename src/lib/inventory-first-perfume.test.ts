import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {normalizePerfumeIdentity} from './records'

const page=readFileSync('src/pages/InventoryPage.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')

describe('Estoque → primeiro perfume',()=>{
  it('normaliza caixa, espaços, acentos e travessões para impedir duplicidade',()=>{
    expect(normalizePerfumeIdentity('  JÓVOY — FITE  AT WILL ')).toBe(normalizePerfumeIdentity('jovoy - fite at will'))
  })
  it('expõe o CTA vazio e pré-preenche o nome no modo novo',()=>{
    expect(page).toContain('noResultsLabel="Nenhum perfume encontrado."')
    expect(page).toContain('createLabel={query=>`CADASTRAR “${query}”`}')
    expect(page).toContain("setName(query)")
  })
  it('destaca banco vazio e preserva os dois fluxos',()=>{
    expect(page).toContain('Nenhum perfume cadastrado ainda.')
    expect(page).toContain('CADASTRAR PRIMEIRO PERFUME')
    expect(page).toContain("mode==='new'?'NOVO PERFUME':'PERFUME EXISTENTE'")
  })
  it('cria o canônico antes do inventory_item e usa o id devolvido',()=>{
    expect(page.indexOf('createCanonicalPerfume({name,brand})')).toBeLessThan(page.indexOf('receiveInventoryPerfume({perfumeId:selected.id'))
    expect(records).toContain("from('perfumes').insert")
    expect(records).toContain("error.code==='23505'")
  })
})
