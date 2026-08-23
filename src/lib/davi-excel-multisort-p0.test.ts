import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const migration=readFileSync('supabase/migrations/202608230008_davi_excel_safe_existing_sale_update.sql','utf8')

describe('classificação global do Davi Excel',()=>{
 it('preset operacional tem os quatro níveis na ordem aprovada',()=>{expect(records).toContain("[{column:'sale_date',direction:'asc'},{column:'perfume',direction:'asc'},{column:'type',direction:'asc'},{column:'volume',direction:'desc'}]");expect(page).toContain('ORGANIZAR OPERAÇÃO')})
 it('classifica globalmente antes de limitar e paginar',()=>{expect(records).toContain("rpc('davi_excel_list_multi'");expect(migration.indexOf('order by %s,id desc')).toBeLessThan(migration.indexOf('limit $2 offset $3'));expect(migration).toContain('count(*)over() total_count')})
 it('aceita até cinco níveis com coluna e direção em lista branca',()=>{expect(migration).toContain('if position>5 then exit');expect(migration).toContain("if direction not in('asc','desc')");for(const column of ['client','sale_date','deadline','shipped_at','type','volume','perfume','amount','payment','method','paid_at','credit','notes'])expect(migration).toContain(`when '${column}'`);expect(page).toContain('ADICIONAR NÍVEL')})
 it('normaliza texto para português e mantém nulos ao final',()=>{expect(migration).toContain('davi_excel_sort_text');expect(migration).toContain("'áàãâäéèêëíìîïóòõôöúùûüç'");expect(migration).toContain("regexp_replace(btrim(coalesce(p_value,''))");expect(migration).toContain("||' nulls last'")})
 it('não grava vendas, estoque ou shipment',()=>{const sort=migration.slice(migration.indexOf('create function public.davi_excel_sort_text'));expect(sort).not.toMatch(/update public\.sales|insert into public\.sales|inventory_apply|update public\.shipments|update public\.shipment_items/)})
 it('preserva componentes por sale.id e drafts fora do reload da grade',()=>{expect(page).toContain('<ExistingSaleRow key={row.id}');expect(page).toContain('<DaviExcelNewRows onCreated={load}/>');expect(page).toContain("localStorage.setItem('davi_excel_state'")})
 it('mostra direção e prioridade no cabeçalho e permite limpar',()=>{expect(page).toContain("sortLevel.direction==='asc'?'↑':'↓'");expect(page).toContain('sortIndex+1');expect(page).toContain('LIMPAR CLASSIFICAÇÃO')})
})
