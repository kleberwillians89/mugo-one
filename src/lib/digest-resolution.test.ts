import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const fix=readFileSync(new URL('../../supabase/migrations/202608140005_fix_pgcrypto_digest_resolution.sql',import.meta.url),'utf8')
const priorMigrations={
  '202608140001':readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql',import.meta.url),'utf8'),
  '202608140002':readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8'),
  '202608140003':readFileSync(new URL('../../supabase/migrations/202608140003_ai_multi_perfume_atomic_import.sql',import.meta.url),'utf8'),
  '202608140004':readFileSync(new URL('../../supabase/migrations/202608140004_perfume_resolution_hotfix.sql',import.meta.url),'utf8'),
}
const recordsSource=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('bug real: function digest(text, unknown) does not exist',()=>{
  it('não toca nenhuma migration já aplicada (001/002/003) nem a 004, que é outro assunto',()=>{
    for(const [name,migration] of Object.entries(priorMigrations)){
      expect(migration,name).not.toContain('ai_sha256_hex')
      expect(migration,name).not.toContain('extensions.digest')
    }
  })
  it('todas as ocorrências de digest(...) sem schema nas migrations aplicadas foram inventariadas',()=>{
    expect(priorMigrations['202608140002']).toContain("encode(digest(p_fingerprint||'|'||created_sales::text,'sha256'),'hex')")
    expect(priorMigrations['202608140003']).toMatch(/signature:=encode\(digest\(/)
  })
})

describe('fix: helper reutilizável com fallback defensivo, sem alargar search_path',()=>{
  it('cria public.ai_sha256_hex chamando extensions.digest primeiro',()=>{
    expect(fix).toContain('create or replace function public.ai_sha256_hex(value text)')
    expect(fix).toContain('return encode(extensions.digest(value,\'sha256\'),\'hex\');')
  })
  it('não confia cegamente no schema: cai para public.digest se extensions.digest não existir', ()=>{
    expect(fix).toContain('exception when undefined_function then')
    expect(fix).toContain('return encode(public.digest(value,\'sha256\'),\'hex\');')
  })
  it('search_path permanece restrito a public — não alarga para extensions',()=>{
    for(const match of fix.matchAll(/set search_path=([a-z_,]+)/g))
      expect(match[1].replace(/,$/,''),'search_path deveria continuar restrito').toBe('public')
  })
  it('nenhuma chamada a digest(...) sem schema restou nas funções corrigidas',()=>{
    const body=fix.slice(fix.indexOf('create or replace function public.confirm_ai_sales_batch('))
    expect(body).not.toMatch(/[^.]digest\(/)
  })
})

describe('mesma assinatura: replace de verdade, não overload novo',()=>{
  it('confirm_ai_sales_batch mantém a assinatura de 202608140002 (4 argumentos)',()=>{
    expect(fix).toContain('create or replace function public.confirm_ai_sales_batch(\n  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb\n)')
    expect(fix).toContain('revoke all on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) from public,anon;')
  })
  it('confirm_ai_sales_batch_multi mantém a assinatura de 202608140003 (7 argumentos)',()=>{
    expect(fix).toContain('revoke all on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) from public,anon;')
  })
})

describe('corrige single E multi, não só o ponto que explodiu no smoke',()=>{
  it('confirm_ai_sales_batch (single-perfume) usa o helper',()=>{
    const single=fix.slice(fix.indexOf('function public.confirm_ai_sales_batch('),fix.indexOf('function public.confirm_ai_sales_batch_multi('))
    expect(single).toContain('signature:=public.ai_sha256_hex(p_fingerprint||')
  })
  it('confirm_ai_sales_batch_multi usa o helper com assinatura determinística preservada',()=>{
    const multi=fix.slice(fix.indexOf('function public.confirm_ai_sales_batch_multi('))
    expect(multi).toContain('signature:=public.ai_sha256_hex(')
    expect(multi).not.toContain('created_sales::text')
  })
  it('bootstrap_ai_batch_inventory não usa digest (não precisa do fix)',()=>{
    const source=priorMigrations['202608140002']
    const start=source.indexOf('create or replace function public.bootstrap_ai_batch_inventory(')
    const end=source.indexOf('end;$$;',start)
    expect(source.slice(start,end)).not.toContain('digest(')
  })
})

describe('preserva tudo que já estava aprovado',()=>{
  it('atomicidade, idempotência e pending permanecem intactos',()=>{
    expect(fix).toContain("existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true)")
    expect(fix).toContain("'pending'")
  })
  it('zero shipment, allocation e superfrete',()=>{
    expect(fix).not.toContain('insert into public.shipments')
    expect(fix).not.toContain('insert into public.inventory_allocations')
    expect(fix).not.toMatch(/superfrete/i)
  })
})

describe('erro técnico nunca chega cru ao operador',()=>{
  it('helper central traduz erros de negócio conhecidos e usa fallback genérico para o resto',()=>{
    expect(recordsSource).toContain('function friendlyAiImportError')
    expect(recordsSource).toContain("console.error('ai_import_technical_error',raw)")
    expect(recordsSource).toContain("return new Error('Não foi possível concluir a importação. Nenhuma venda foi criada.')")
  })
  it('confirmAiSalesBatch, confirmAiSalesBatchMulti e bootstrapAiBatchInventory passam pelo helper',()=>{
    const matches=[...recordsSource.matchAll(/throw friendlyAiImportError\(/g)]
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })
  it('um erro técnico não reconhecido (ex.: erro de função ausente) nunca aparece na lista de mensagens amigáveis mostradas ao operador',()=>{
    expect(recordsSource).not.toMatch(/digest\(text, unknown\)/)
  })
})
