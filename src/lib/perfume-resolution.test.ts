import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const sql=readFileSync(new URL('../../supabase/migrations/202608140004_perfume_resolution_hotfix.sql',import.meta.url),'utf8')
const priorMigrations=[
  readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql',import.meta.url),'utf8'),
  readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8'),
  readFileSync(new URL('../../supabase/migrations/202608140003_ai_multi_perfume_atomic_import.sql',import.meta.url),'utf8'),
]
const recordsSource=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const componentSource=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')

describe('hotfix não toca as migrations já aplicadas',()=>{
  it('001/002/003 permanecem sem referência ao hotfix',()=>{
    for(const migration of priorMigrations)expect(migration).not.toContain('normalize_ai_brand')
  })
})

describe('hierarquia de resolução determinística',()=>{
  it('zero candidatos → cria perfume canônico + inventory item',()=>{
    expect(sql).toContain('insert into public.perfumes(organization_id,full_name_raw,normalized_name,base_name,brand_house,bottle_identifier)')
    const createIndex=sql.indexOf('insert into public.perfumes(')
    const elseIndex=sql.lastIndexOf('else',createIndex)
    expect(elseIndex).toBeGreaterThan(-1)
  })
  it('um candidato exato (nome+marca) → reaproveita o perfume, não cria outro',()=>{
    expect(sql).toContain('elsif exact_count=1 then')
    expect(sql).toContain('perfume:=candidate_ids[1];')
  })
  it('marca diferente não é considerada igual: filtro de marca aplicado no match exato',()=>{
    expect(sql).toContain('public.normalize_ai_brand(p.brand_house)=brand_normalized')
    expect(sql).toContain('brand_normalized:=nullif(public.normalize_ai_brand(p_brand)')
  })
  it('2+ candidatos → retorna ambiguous SEM exceção e SEM escrever nada, com candidatos para seleção humana',()=>{
    expect(sql).toContain("if exact_count>1 then")
    expect(sql).toContain("'resolution_status','ambiguous'")
    expect(sql).toContain("'candidates',coalesce(candidates_json,'[]'::jsonb)")
    expect(sql).not.toMatch(/exact_count>1[\s\S]{0,400}raise exception 'perfume_resolution_ambiguous'/)
  })
  it('detecta duplicata canônica real (mesmo normalized_name) e audita sem fazer merge destrutivo',()=>{
    expect(sql).toContain("'duplicate_canonical_perfume_detected'")
    expect(sql).toContain('distinct_normalized_count=1')
    expect(sql).not.toMatch(/delete from public\.perfumes/)
    expect(sql).not.toMatch(/update public\.perfumes set.*merge/i)
  })
  it('seleção humana explícita é revalidada pelo backend (tenant + compatibilidade de nome), nunca confiança cega',()=>{
    expect(sql).toContain('where id=p_selected_perfume_id and organization_id=p_organization_id')
    expect(sql).toContain("raise exception 'invalid_perfume_selection'")
    expect(sql).toContain("raise exception 'perfume_selection_incompatible'")
    expect(sql).toContain("if p_selected_perfume_id is null then raise exception 'perfume_selection_required'; end if;")
  })
  it('FRASCO continua fora da identidade canônica; bottle_number vira metadado, não parte do nome',()=>{
    expect(sql).toContain("frasco\\s+[0-9]+")
    expect(sql).toContain("'FRASCO '||p_bottle_number")
  })
  it('retry (idempotência) continua funcionando e não duplica perfume/item/bootstrap',()=>{
    expect(sql).toContain("resolution_status','idempotent'")
    expect(sql).toContain('select * into prior from public.ai_inventory_bootstraps where organization_id=p_organization_id and fingerprint=p_fingerprint and normalized_perfume_name=normalized')
  })
  it('nunca cria um segundo inventory item para o mesmo perfume no tenant, sob nenhum caminho de resolução',()=>{
    expect(sql).toContain('select i.* into item from public.inventory_items i where i.perfume_id=perfume and i.organization_id=p_organization_id limit 1')
  })
  it('preserva estoque/vendas/atomicidade já aprovados: bootstrap_pending_verification, review_required, pending, zero shipment/superfrete/allocation',()=>{
    expect(sql).toContain("'review_required',true,auth.uid())")
    expect(sql).not.toContain('insert into public.shipments')
    expect(sql).not.toContain('insert into public.inventory_allocations')
    expect(sql).not.toMatch(/superfrete/i)
  })
})

describe('frontend: erro técnico nunca aparece cru ao operador',()=>{
  it('P0001/perfume_resolution_ambiguous é traduzido antes de virar Error',()=>{
    expect(recordsSource).toContain("Encontramos mais de um cadastro para este perfume. Escolha o registro correto antes de continuar.")
    expect(recordsSource).not.toMatch(/throw new Error\(['"`]P0001/)
  })
  it('seleção inválida também recebe mensagem humana',()=>{
    expect(recordsSource).toContain('A seleção de perfume não é válida para este lote')
  })
  it('bootstrapAiBatchInventory aceita selectedPerfumeId e envia p_selected_perfume_id',()=>{
    expect(recordsSource).toContain('selectedPerfumeId')
    expect(recordsSource).toContain('p_selected_perfume_id:input.selectedPerfumeId')
  })
})

describe('sem overload ambíguo de RPC no PostgREST',()=>{
  it('bootstrap_ai_batch_inventory mantém a MESMA assinatura de 202608140002 (7 argumentos) — é um replace de verdade, não um novo overload',()=>{
    const priorSignature="create or replace function public.bootstrap_ai_batch_inventory(\n  p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,\n  p_bottle_number integer,p_reference_date date,p_sales jsonb\n)"
    expect(sql).toContain(priorSignature)
    expect(sql).toContain('revoke all on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) from public,anon;')
    expect(sql).toContain('grant execute on function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb) to authenticated;')
  })
  it('o caminho de seleção humana é uma função com NOME DIFERENTE, não um overload de bootstrap_ai_batch_inventory',()=>{
    expect(sql).toContain('create or replace function public.bootstrap_ai_batch_inventory_resolved(')
    expect(sql).toContain('revoke all on function public.bootstrap_ai_batch_inventory_resolved(uuid,text,text,text,integer,date,jsonb,uuid) from public,anon;')
    expect(sql).toContain('grant execute on function public.bootstrap_ai_batch_inventory_resolved(uuid,text,text,text,integer,date,jsonb,uuid) to authenticated;')
  })
  it('nenhuma declaração de bootstrap_ai_batch_inventory com 8 argumentos (o que criaria o overload de risco)',()=>{
    expect(sql).not.toMatch(/function public\.bootstrap_ai_batch_inventory\(\s*\n\s*p_organization_id uuid,p_fingerprint text,p_raw_perfume_name text,p_brand text,\s*\n\s*p_bottle_number integer,p_reference_date date,p_sales jsonb,p_selected_perfume_id/)
    expect(sql).not.toContain('function public.bootstrap_ai_batch_inventory(uuid,text,text,text,integer,date,jsonb,uuid)')
  })
  it('records.ts chama duas RPCs com nomes distintos, nunca a mesma RPC com/sem o parâmetro extra',()=>{
    expect(recordsSource).toContain("await supabase!.rpc('bootstrap_ai_batch_inventory_resolved'")
    expect(recordsSource).toContain("await supabase!.rpc('bootstrap_ai_batch_inventory',base)")
  })
})

describe('UI de seleção de candidato',()=>{
  it('mostra nome e marca, nunca o UUID como informação principal',()=>{
    const block=componentSource.slice(componentSource.indexOf('ambiguousCandidates.map'),componentSource.indexOf('ambiguousCandidates.map')+900)
    expect(block).toContain('candidate.name')
    expect(block).toContain('candidate.brand')
    expect(block).not.toMatch(/<strong>\{candidate\.perfume_id\}/)
  })
  it('seleção do candidato reenvia o bootstrap com o id escolhido',()=>{
    expect(componentSource).toContain('createFromSales(candidate.perfume_id)')
  })
  it('cancelar limpa o estado de ambiguidade',()=>{
    expect(componentSource).toContain('closeBootstrap')
  })
})
