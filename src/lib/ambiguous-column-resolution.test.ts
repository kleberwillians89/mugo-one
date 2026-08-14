import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const fix=readFileSync(new URL('../../supabase/migrations/202608140006_fix_ai_import_ambiguous_totals.sql',import.meta.url),'utf8')
const priorMigrations={
  '202608140001':readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql',import.meta.url),'utf8'),
  '202608140002':readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8'),
  '202608140003':readFileSync(new URL('../../supabase/migrations/202608140003_ai_multi_perfume_atomic_import.sql',import.meta.url),'utf8'),
  '202608140004':readFileSync(new URL('../../supabase/migrations/202608140004_perfume_resolution_hotfix.sql',import.meta.url),'utf8'),
  '202608140005':readFileSync(new URL('../../supabase/migrations/202608140005_fix_pgcrypto_digest_resolution.sql',import.meta.url),'utf8'),
}
const tableColumns=['id','organization_id','fingerprint','source_text','sale_date','groups_count','sales_count','total_ml','total_amount','availability_ml','availability_amount','result','created_by','created_at']

describe('bug real: 42702 column reference "total_ml" is ambiguous',()=>{
  it('não toca nenhuma migration já aplicada (001-005)',()=>{
    for(const [name,migration] of Object.entries(priorMigrations))
      expect(migration,name).not.toContain('v_total_ml')
  })
  it('reproduz o padrão exato do bug: a versão anterior declarava variável E atualizava coluna do mesmo nome, ambas desqualificadas, na mesma instrução',()=>{
    const buggy=priorMigrations['202608140005']
    const declares=/total_ml numeric:=0/.test(buggy)
    const selfAssigns=buggy.includes('total_ml=total_ml')
    expect(declares&&selfAssigns,'a versão substituída realmente tinha a colisão de nomes').toBe(true)
  })
})

describe('fix: variáveis renomeadas com prefixo v_, sem colisão com colunas da tabela',()=>{
  it('declara v_total_ml, v_total_amount, v_availability_ml, v_availability_amount',()=>{
    expect(fix).toContain('v_total_ml numeric:=0; v_total_amount numeric:=0; v_availability_ml numeric:=0; v_availability_amount numeric:=0;')
  })
  it('a instrução UPDATE nunca mais faz coluna=variável com o mesmo nome desqualificado',()=>{
    for(const column of ['total_ml','total_amount','availability_ml','availability_amount'])
      expect(fix,`${column}=${column} não pode existir mais`).not.toContain(`${column}=${column}`)
  })
  it('nenhuma das quatro variáveis renomeadas colide com uma coluna real de ai_sales_batch_imports',()=>{
    for(const name of ['v_total_ml','v_total_amount','v_availability_ml','v_availability_amount'])
      expect(tableColumns).not.toContain(name)
  })
})

describe('auditoria preventiva: todo nome usado na função foi checado contra as colunas da tabela',()=>{
  const declareBlock=fix.slice(fix.indexOf('declare\n',fix.indexOf('confirm_ai_sales_batch_multi')),fix.indexOf('\nbegin\n',fix.indexOf('confirm_ai_sales_batch_multi')))
  const declared=declareBlock.split(';').map(fragment=>fragment.trim().split(/\s+/)[0]).filter(Boolean)
  it.each([
    ['sales_created','seguro — sem coluna homônima'],
    ['clients_created','seguro — sem coluna homônima'],
    ['clients_existing','seguro — sem coluna homônima'],
    ['perfumes_processed','seguro — sem coluna homônima'],
    ['perfumes_matched','seguro — sem coluna homônima'],
    ['inventory_items_bootstrapped','seguro — sem coluna homônima'],
    ['incomplete','seguro — sem coluna homônima'],
    ['paid_source_count','seguro — sem coluna homônima'],
    ['awaiting_source_count','seguro — sem coluna homônima'],
    ['unstated_payment_count','seguro — sem coluna homônima'],
    ['v_total_ml','corrigido — renomeado, coluna real é total_ml'],
    ['v_total_amount','corrigido — renomeado, coluna real é total_amount'],
    ['v_availability_ml','corrigido — renomeado, coluna real é availability_ml'],
    ['v_availability_amount','corrigido — renomeado, coluna real é availability_amount'],
  ])('%s: %s',(name)=>{
    expect(declared).toContain(name)
    expect(tableColumns).not.toContain(name)
  })
  it('nenhuma variável declarada na função tem o mesmo nome de uma coluna de ai_sales_batch_imports',()=>{
    const collisions=declared.filter(name=>tableColumns.includes(name))
    expect(collisions).toEqual([])
  })
})

describe('confirm_ai_sales_batch (single-perfume) auditado: não tem a mesma colisão, não precisou de correção',()=>{
  it('total_ml/total_amount só aparecem no INSERT (valores do payload), nunca num UPDATE contra variável homônima',()=>{
    const source=priorMigrations['202608140005']
    const start=source.indexOf('create or replace function public.confirm_ai_sales_batch(')
    const end=source.indexOf('end;$$;',start)
    const body=source.slice(start,end)
    expect(body).toContain('insert into public.ai_sales_batches(')
    expect(body).not.toMatch(/update public\.ai_sales_batches set[^;]*total_ml/)
    expect(body).not.toMatch(/update public\.ai_sales_batches set[^;]*total_amount/)
  })
})

describe('mesma assinatura: replace de verdade, zero overload novo',()=>{
  it('confirm_ai_sales_batch_multi mantém os mesmos 7 argumentos de 202608140003/202608140005',()=>{
    expect(fix).toContain('create or replace function public.confirm_ai_sales_batch_multi(\n  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,\n  p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb\n)')
    expect(fix).toContain('revoke all on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) from public,anon;')
    expect(fix).toContain('grant execute on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) to authenticated,service_role;')
  })
})

describe('single: agregados corretos',()=>{
  it('sales_created e valores continuam vindo do payload confirmado, não de nomes ambíguos',()=>{
    expect(priorMigrations['202608140005']).toContain("'sales_created',created_sales")
  })
})

describe('multi: agregados corretos e sem ambiguidade',()=>{
  it('total_ml_sold/total_amount_sold/commercial_remaining_* usam as variáveis renomeadas',()=>{
    expect(fix).toContain("'total_ml_sold',v_total_ml,'total_amount_sold',round(v_total_amount,2)")
    expect(fix).toContain("'commercial_remaining_ml',v_availability_ml,'commercial_remaining_amount',round(v_availability_amount,2)")
  })
})

describe('preserva tudo que já funciona',()=>{
  it('digest via ai_sha256_hex preservado',()=>{
    expect(fix).toContain('signature:=public.ai_sha256_hex(')
    expect(fix).not.toMatch(/[^.]digest\(/)
  })
  it('atomicidade e idempotência preservadas',()=>{
    expect(fix).toContain("existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true)")
    expect(priorMigrations['202608140003']).toContain('unique(organization_id,fingerprint)')
  })
  it('pending, zero allocation, zero shipment, zero superfrete preservados',()=>{
    expect(fix).toContain("'pending'")
    expect(fix).not.toContain('insert into public.inventory_allocations')
    expect(fix).not.toContain('insert into public.shipments')
    expect(fix).not.toMatch(/superfrete/i)
  })
})
