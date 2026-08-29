import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const analyzer=readFileSync('scripts/analyze-incremental-workbook.mjs','utf8')
const rpc=readFileSync('supabase/migrations/202608280003_incremental_split_completed_at.sql','utf8')

describe('analyzer incremental — matching conservador',()=>{
 it('identidade comercial ignora o sufixo (FRASCO n)',()=>{
  expect(analyzer).toContain('commercialPerfumeBase')
  expect(analyzer).toContain('const basePerfumeName=commercialPerfumeBase(row.source_perfume)')
  expect(readFileSync('scripts/incremental-approved-decisions.mjs','utf8')).toContain('\\s*\\(frasco\\s*\\d+\\)')
 })
 it('normaliza espaçamento em torno de "&"',()=>{
  expect(readFileSync('scripts/incremental-approved-decisions.mjs','utf8')).toContain("replace(/\\s*&\\s*/g, ' & ')")
 })
 it('campos mutáveis não entram na identidade',()=>{
  expect(analyzer).toContain("const mutableFields=['payment_status','payment_method','paid_at','shipped_at','credit','note'")
 })
 it('pareamento multiset/ordinal dentro do grupo de identidade',()=>{
  expect(analyzer).toContain('const indexes={core:new Map(),noAmount:new Map(),noMl:new Map(),noPerfume:new Map()}')
  expect(analyzer).toContain('filter((candidate)=>!used.has(candidate.id))')
  expect(analyzer).toContain('used.add(result.match.id)')
  expect(analyzer).toContain("classification:'existing_exact',match:candidate")
  expect(analyzer).toContain("classification:'existing_changed',match:candidate")
 })
 it('excedente de planilha vira NEW, ou possible_duplicate se houver near-miss não pareado',()=>{
  expect(analyzer).toContain('...indexedCandidates(indexes.noAmount,row')
  expect(analyzer).toContain("classification:'new_safe'")
  expect(analyzer).toContain("classification:'possible_duplicate'")
 })
 it('multiplicidade da fonte não vira ambiguidade sem near-miss no banco',()=>{
  expect(analyzer).not.toContain('occurrences>0')
  expect(analyzer).toContain('if(near.length>=1)')
 })
 it('MISSING_FROM_NEW_SOURCE é calculado e nunca deletado',()=>{
  expect(analyzer).toContain('const missingFromNewSource=existing.length-used.size')
  expect(analyzer).toContain('MISSING_FROM_NEW_SOURCE:missingFromNewSource')
  expect(analyzer).toContain('preserve_missing:true')
  expect(analyzer).not.toMatch(/delete\s+from|DELETE\s+FROM/)
 })
 it('linhas administrativas (TOTAL / DISPONÍVEL) são separadas, não rejeitadas',()=>{
  expect(analyzer).toContain("const ignoredOperationalRows=populated.filter(({raw})=>['total:','disponivel para venda'].includes(normalize(raw.CLIENTE)))")
  expect(analyzer).toContain("const sourceRows=populated.filter(({raw})=>!['total:','disponivel para venda'].includes(normalize(raw.CLIENTE)))")
  expect(analyzer).toContain('ignored_operational_lines:ignoredOperationalRows.length')
 })
 it('aceita layout de 13 e 14 colunas sem deslocar VALOR (leitura por nome)',()=>{
  expect(analyzer).toContain("normalize(header)==='data do split'")
  expect(analyzer).toContain('Object.fromEntries(headers.map((header,column)=>[header,values[column]??null]))')
 })
 it('mantém chaves planas de compatibilidade com o apply/RPC',()=>{
  expect(analyzer).toContain('total_lines:staging.length')
  expect(analyzer).toContain('rejected:counts.review_required,...counts')
 })
})

describe('RPC incremental 202608280003 — invariantes preservadas',()=>{
 it('só service_role + admin; idempotência por file_hash; sem estoque',()=>{
  expect(rpc).toContain("if auth.role()<>'service_role' then raise exception 'service_role_required'")
  expect(rpc).toContain("where organization_id=p_organization_id and user_id=p_user_id and role='admin'")
  expect(rpc).toContain('where organization_id=p_organization_id and file_hash=p_file_hash and status=')
  expect(rpc).not.toMatch(/insert into public\.inventory_(items|movements|purchase_entries)/)
  expect(rpc).not.toMatch(/insert into public\.(shipments|preparation_batches)/)
 })
 it('split_completed_at: NEW insere quando SPLIT; CHANGED nunca apaga (nulo = no-op)',()=>{
  expect(rpc).toContain("when upper(r.item->>'type')='SPLIT' and (r.item->>'split_completed_at') is not null")
  expect(rpc).toContain("when (r.item->>'split_completed_at') is not null and sale_type='SPLIT'")
 })
 it('não edita a migration histórica',()=>{
  expect(readFileSync('supabase/migrations/202608130002_incremental_import_apply.sql','utf8')).not.toContain('split_completed_at')
 })
})
