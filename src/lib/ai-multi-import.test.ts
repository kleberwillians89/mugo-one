import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const sql=readFileSync(new URL('../../supabase/migrations/202608140003_ai_multi_perfume_atomic_import.sql',import.meta.url),'utf8')
const enhancements=readFileSync(new URL('../enhancements.css',import.meta.url),'utf8')
const globalStyles=readFileSync(new URL('../styles.css',import.meta.url),'utf8')
const componentSource=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')
const previousMigrations=[
  readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql',import.meta.url),'utf8'),
  readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8'),
]

describe('write multiperfume atômico (migration nova, não aplicada)',()=>{
  it('não toca as migrations já aplicadas em produção',()=>{
    expect(previousMigrations[0]).not.toContain('confirm_ai_sales_batch_multi')
    expect(previousMigrations[1]).not.toContain('confirm_ai_sales_batch_multi')
  })
  it('é uma única função PL/pgSQL (transação implícita): qualquer raise desfaz todos os grupos já processados',()=>{
    expect(sql).toContain('language plpgsql security definer')
    expect(sql).toContain("raise exception 'inventory_resolution_required'")
    expect(sql).toContain("raise exception 'client_resolution_required'")
    expect(sql).toContain("raise exception 'client_resolution_ambiguous'")
    expect(sql).toContain("raise exception 'groups_required'")
  })
  it('recusa iniciar o write se algum grupo não estiver resolvido, antes de qualquer insert',()=>{
    const readinessIndex=sql.indexOf('inventory_resolution_required')
    const firstInsertIndex=sql.indexOf('insert into public.ai_sales_batch_imports')
    expect(readinessIndex).toBeGreaterThan(-1)
    expect(firstInsertIndex).toBeGreaterThan(readinessIndex)
  })
  it('reaproveita validate_ai_batch_inventory em vez de duplicar a lógica de resolução',()=>{
    expect(sql).toContain('public.validate_ai_batch_inventory(p_organization_id,group_inventory_item_id)')
  })
  it('idempotência do lote inteiro por fingerprint, retornando o resultado anterior',()=>{
    expect(sql).toContain('unique(organization_id,fingerprint)')
    expect(sql).toContain("existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true)")
  })
  it('assinatura por venda usa campos determinísticos, não o índice do array',()=>{
    expect(sql).toContain('normalize_ai_perfume_name(group_perfume_name)')
    expect(sql).not.toContain('created_sales::text')
  })
  it('perfume existente não recebe ML das vendas (sem update em inventory_items)',()=>{
    expect(sql).not.toMatch(/update public\.inventory_items/)
  })
  it('zero efeitos colaterais: nenhum shipment, superfrete ou allocation para pending',()=>{
    expect(sql).not.toContain('insert into public.shipments')
    expect(sql).not.toContain('insert into public.inventory_allocations')
    expect(sql).not.toMatch(/superfrete/i)
    expect(sql).toContain("'pending'")
  })
  it('retorna o contrato de resultado determinístico esperado pelo resumo',()=>{
    for(const field of ['sales_created','clients_created','clients_existing','perfumes_processed','perfumes_matched','inventory_items_bootstrapped','total_ml_sold','total_amount_sold','commercial_remaining_ml','commercial_remaining_amount','shipping_incomplete','paid_source_count','awaiting_source_count','unstated_payment_count','idempotent'])
      expect(sql).toContain(`'${field}'`)
  })
  it('conta itens já em bootstrap_pending_verification como aguardando conferência, sem duplicar bootstrap',()=>{
    expect(sql).toContain('bootstrap_pending_verification into group_bootstrap_pending')
    expect(sql).toContain('inventory_items_bootstrapped:=inventory_items_bootstrapped+1')
  })
  it('audita a confirmação multiperfume',()=>{
    expect(sql).toContain("'ai_sales_batch_multi_confirmed'")
  })
})

describe('resumo final: números vêm do banco, IA só escreve o texto',()=>{
  it('confirmAiSalesBatchMulti chama a RPC atômica e retorna o resultado tipado',()=>{
    expect(readFileSync(new URL('./records.ts',import.meta.url),'utf8')).toContain("supabase!.rpc('confirm_ai_sales_batch_multi'")
  })
  it('summarizeAiBatchImport nunca lança: falha do LLM não derruba a importação concluída',()=>{
    const recordsSource=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
    expect(recordsSource).toContain('export async function summarizeAiBatchImport')
    expect(recordsSource).toMatch(/summarizeAiBatchImport[\s\S]*?catch\{return null\}/)
  })
  it('componente mostra o fallback determinístico mesmo quando a IA ainda não respondeu',()=>{
    expect(componentSource).toContain("aiText&&<div className=\"batch-summary-ai\"")
    expect(componentSource).toContain('IMPORTAÇÃO CONCLUÍDA')
  })
  it('resumo separa vendas reais do saldo comercial ("disponível para venda")',()=>{
    expect(componentSource).toContain('commercial_remaining_ml')
    expect(componentSource).toContain('permaneceram marcados como disponíveis para venda')
    expect(componentSource).toContain('grossTotal')
  })
  it('botão multiperfume não fica mais bloqueado por padrão',()=>{
    expect(componentSource).not.toContain('A criação multiperfume transacional ainda não está habilitada.')
  })
  it('gate de prontidão mostra pendências e permite ir até a primeira',()=>{
    expect(componentSource).toContain('IMPORTAÇÃO AINDA NÃO ESTÁ PRONTA')
    expect(componentSource).toContain('goToFirstPending')
  })
  it('estado de processamento e erro não deixam o operador sem feedback',()=>{
    expect(componentSource).toContain('IMPORTANDO VENDAS')
    expect(componentSource).toContain('Não feche esta janela')
    expect(componentSource).toContain('NENHUMA VENDA FOI CRIADA')
    expect(componentSource).toContain('TENTAR NOVAMENTE')
  })
})

describe('faixa preta sobre a lista de vendas (bug de scroll)',()=>{
  it('o header global position:sticky não vaza mais para os cabeçalhos escuros do modal de IA',()=>{
    expect(globalStyles).toMatch(/header\{[^}]*position:sticky/)
    expect(enhancements).toMatch(/\.ai-batch-assistant>header\{position:static/)
    expect(enhancements).toContain('.batch-sales-group>header{position:static}')
  })
  it('o backdrop fixo e o container de scroll são elementos separados (evita o bug de repaint de backdrop-filter+fixed+overflow)',()=>{
    expect(enhancements).toMatch(/\.ai-batch-layer\{position:fixed;z-index:120;inset:0;background:#17140fba;backdrop-filter:blur\(5px\)\}/)
    expect(enhancements).toMatch(/\.ai-batch-scroll\{position:fixed;inset:0;overflow-y:auto/)
    expect(enhancements).not.toMatch(/\.ai-batch-layer\{[^}]*overflow:auto/)
  })
  it('componente usa a nova camada de scroll dedicada',()=>{
    expect(componentSource).toContain('className="ai-batch-scroll"')
  })
})
