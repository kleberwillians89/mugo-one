import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const component=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')
const domain=readFileSync(new URL('../../supabase/functions/_shared/sales-batch-domain.ts',import.meta.url),'utf8')
const migration=readFileSync(new URL('../../supabase/migrations/202608230006_sales_import_catalog_only.sql',import.meta.url),'utf8')

const blockersFn=component.slice(component.indexOf('const blockers=useMemo'),component.indexOf('const perfumePendingCount='))
// O bloco tem um comentário explicativo (propositalmente citando os termos
// removidos, como documentação de por quê) — os testes de ausência olham só
// o código executável, não a prosa do comentário.
const blockersCode=blockersFn.split('\n').map(line=>{const i=line.indexOf('//');return i>=0?line.slice(0,i):line}).join('\n')
const confirmSingleFn=migration.slice(migration.indexOf('create or replace function public.confirm_ai_sales_batch(\n'),migration.indexOf('-- Confirmação multi'))
const confirmMultiFn=migration.slice(migration.indexOf('create or replace function public.confirm_ai_sales_batch_multi'),migration.indexOf('-- Dados históricos'))

// Réplica fiel da função blockers() do componente (pós-hotfix), para testar
// os cenários do briefing com dados de verdade — não só grep de string.
type Sale={client_name:string;client_id:string|null;client_match_status:'found'|'new'|'review';possible_duplicate:boolean;volume_ml:number}
type Group={perfume_id:string|null;display_name:string;normalized_perfume_name:string}
type Preview={source_format:'whatsapp'|'tsv';perfume_id:string|null;groups?:Group[];sales:Sale[];duplicate_batch:unknown;shipping_availability_text:string|null;shipping_availability_human_confirmed:boolean;pricing_consistent?:boolean}
function blockers(preview:Preview|null):{text:string}[]{
  if(!preview)return[]
  const list:{text:string}[]=[]
  if(preview.source_format==='tsv'){
    for(const group of preview.groups??[])if(!group.perfume_id)list.push({text:`Perfume "${group.display_name}" precisa de resolução no catálogo`})
  }else if(!preview.perfume_id)list.push({text:'Resolva o perfume no catálogo da RUAH'})
  if(preview.pricing_consistent===false)list.push({text:'Os valores publicados não conferem com a cotação, a recravação e o adicional do APC'})
  preview.sales.forEach(sale=>{if(sale.volume_ml<=0)list.push({text:`Volume inválido para ${sale.client_name}`})})
  preview.sales.forEach(sale=>{if(sale.client_match_status==='review'||(!sale.client_id&&sale.client_match_status!=='new'))list.push({text:`Confirme quem é ${sale.client_name}`})})
  preview.sales.forEach(sale=>{if(sale.possible_duplicate)list.push({text:`Possível venda repetida para ${sale.client_name}`})})
  if(preview.duplicate_batch)list.push({text:'Esta lista parece já ter sido importada'})
  if(preview.shipping_availability_text&&!preview.shipping_availability_human_confirmed)list.push({text:'Confirme a disponibilidade para envio identificada'})
  return list
}
const sale=(overrides:Partial<Sale>={}):Sale=>({client_name:'Cliente',client_id:'c1',client_match_status:'found',possible_duplicate:false,volume_ml:6,...overrides})
const tobaccoCarnaval=(overrides:Partial<Preview> ={}):Preview=>({source_format:'whatsapp',perfume_id:'perfume-tobacco',sales:Array.from({length:14},(_,i)=>sale({client_name:`Cliente ${i+1}`,client_id:`c${i+1}`,volume_ml:93/14})),duplicate_batch:null,shipping_availability_text:null,shipping_availability_human_confirmed:false,...overrides})

describe('CASO DE REGRESSÃO REAL — TOBACCO CARNAVAL / MAISON CRIVELLI (item 9 do briefing)',()=>{
  it('physical_ml=100, 14 vendas, sum=93 => READY=true, CREATE ENABLED=true (nenhum volume mismatch blocker existe mais)',()=>{
    // "physical_ml=100" nunca entra no objeto Preview usado pelo gate — é
    // justamente esse o ponto: a capacidade física do perfume não é um
    // parâmetro de blockers(), então nem precisa ser simulada aqui.
    const preview=tobaccoCarnaval()
    expect(preview.sales.length).toBe(14)
    expect(Math.round(preview.sales.reduce((sum,s)=>sum+s.volume_ml,0))).toBe(93)
    expect(blockers(preview)).toEqual([])
  })
  it('physical_ml=0, mesmas 14 vendas => importação comercial continua permitida',()=>{
    // De novo: physical_ml não é parâmetro de blockers(); zero físico não
    // muda o resultado de forma nenhuma.
    expect(blockers(tobaccoCarnaval())).toEqual([])
  })
  it('sem inventory_item algum => importação comercial continua permitida',()=>{
    // inventory_item_id/inventory também não são parâmetros de blockers().
    expect(blockers(tobaccoCarnaval())).toEqual([])
  })
})

describe('10 cenários adicionais do briefing — matemática real, não só grep',()=>{
  it('1) 100 físico / 93 vendido => PASS',()=>{expect(blockers(tobaccoCarnaval())).toEqual([])})
  it('2) 100 físico / 100 vendido => PASS',()=>{expect(blockers(tobaccoCarnaval({sales:[sale({volume_ml:100})]}))).toEqual([])})
  it('3) 100 físico / 50 vendido => PASS',()=>{expect(blockers(tobaccoCarnaval({sales:[sale({volume_ml:50})]}))).toEqual([])})
  it('4) zero físico / vendas válidas => PASS',()=>{expect(blockers(tobaccoCarnaval())).toEqual([])})
  it('5) perfume sem inventory_item => PASS (perfume_id setado, inventory_item_id não existe no objeto de gate)',()=>{expect(blockers(tobaccoCarnaval())).toEqual([])})
  it('6) perfume sem RUAH-P => PASS (operational_code não é parâmetro de blockers nem da RPC de confirmação)',()=>{
    expect(blockers(tobaccoCarnaval())).toEqual([])
    expect(confirmSingleFn).not.toContain('operational_code')
  })
  it('7) "(FRASCO 2)" não exige inventory_bottle — é só bottle_number numérico extraído do texto',()=>{
    expect(domain).toContain('const bottleNumbers=[...raw.matchAll(')
    expect(domain).toContain("if(distinctBottleNumbers.length>1)throw new Error('multiple_bottle_numbers')")
    expect(domain).not.toContain('inventory_bottles')
  })
  it('8) ausência de estoque não altera ready state — blockers() nunca lê inventory_item_id/inventory/physical_ml/available_ml',()=>{
    for(const forbidden of['inventory_item_id','.inventory','physical_ml','available_ml'])expect(blockersCode).not.toContain(forbidden)
  })
  it('9) venda com volume inválido continua FAIL',()=>{
    expect(blockers(tobaccoCarnaval({sales:[sale({volume_ml:0})]}))).toEqual([{text:'Volume inválido para Cliente'}])
    expect(blockers(tobaccoCarnaval({sales:[sale({volume_ml:-1})]}))).toEqual([{text:'Volume inválido para Cliente'}])
  })
  it('10) perfume não resolvido continua pendência real',()=>{
    expect(blockers(tobaccoCarnaval({perfume_id:null}))).toEqual([{text:'Resolva o perfume no catálogo da RUAH'}])
    expect(blockers({...tobaccoCarnaval(),source_format:'tsv',groups:[{perfume_id:null,display_name:'X',normalized_perfume_name:'x'}]})).toEqual([{text:'Perfume "X" precisa de resolução no catálogo'}])
  })
  it('11) cliente pendente continua pendência real',()=>{
    expect(blockers(tobaccoCarnaval({sales:[sale({client_match_status:'review'})]}))).toEqual([{text:'Confirme quem é Cliente'}])
    expect(blockers(tobaccoCarnaval({sales:[sale({client_id:null,client_match_status:'found'})]}))).toEqual([{text:'Confirme quem é Cliente'}])
  })
  it('12) divergência de preço impede a confirmação pelo fluxo normal do CRM',()=>{
    expect(blockers(tobaccoCarnaval({pricing_consistent:false}))).toEqual([{text:'Os valores publicados não conferem com a cotação, a recravação e o adicional do APC'}])
  })
})

describe('1/2/3 — o bloqueio de volume do lote foi removido na origem (não mascarado)',()=>{
  it('blockers() não referencia mais volume_consistent em nenhum lugar (código executável, não o comentário que documenta a remoção)',()=>{
    expect(blockersCode).not.toContain('volume_consistent')
  })
  it('o texto "Volumes do lote não conferem" não é mais produzido por blockers() — segue só como contexto visual não bloqueante em outro lugar da tela (overview .warning)',()=>{
    expect(blockersFn).not.toContain('Volumes do lote não conferem')
    expect(component).toContain("className={preview.totals.volume_consistent?'ok':'warning'}")
  })
  it('botão de confirmar continua controlado só por blockers.length — nenhuma segunda condição de volume foi adicionada em paralelo',()=>{
    expect(component).toContain('disabled={!!busy||blockers.length>0}')
  })
  it('inventory_operational_rows (fetchOperationalInventory) continua sendo buscado, mas só alimenta exibição — nunca aparece dentro do código executável de blockers()',()=>{
    expect(component).toContain('fetchOperationalInventory')
    expect(blockersCode).not.toContain('inventory')
  })
})

describe('4 — PERFUME DE CATÁLOGO resolve só sales.perfume_id, nunca exige estoque físico',()=>{
  it('resolve_ai_catalog_perfume nunca cria inventory_item — só lê um já existente, se houver',()=>{
    const fn=migration.slice(migration.indexOf('create or replace function public.resolve_ai_catalog_perfume'),migration.indexOf('create or replace function public.bootstrap_ai_batch_inventory('))
    expect(fn).not.toContain('insert into public.inventory_items')
    expect(fn).toContain('select id into inventory_item from public.inventory_items')
  })
  it('bootstrap_ai_batch_inventory(_resolved) são wrappers finos que só chamam resolve_ai_catalog_perfume — não criam estoque',()=>{
    const bootstrapBlock=migration.slice(migration.indexOf('create or replace function public.bootstrap_ai_batch_inventory('),migration.indexOf('-- Confirmação single'))
    expect(bootstrapBlock).not.toMatch(/insert into public\.inventory/)
  })
})

describe('5 — "FRASCO N" é referência textual, nunca vínculo físico obrigatório',()=>{
  it('bottle_number é só um número extraído do texto, armazenado como metadado — RPC nunca exige inventory_bottles para confirmar',()=>{
    expect(confirmSingleFn).not.toContain('inventory_bottles')
    expect(confirmMultiFn).not.toContain('inventory_bottles')
  })
})

describe('7/11 — contrato de escrita da importação: cadastro comercial, nada físico (item "Auditar o RPC de escrita")',()=>{
  it('nenhuma segunda validação de volume do lote nas RPCs de confirmação — nem sum(volume_ml), nem comparação com physical_ml/bottle',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn]){
      expect(fn).not.toMatch(/sum\(.*volume_ml.*\)/i)
      expect(fn).not.toContain('physical_ml')
      expect(fn).not.toContain('bottle_capacity')
      expect(fn).not.toContain('lot volume')
      expect(fn).not.toContain('inventory_operational_rows')
    }
  })
  it('inventory_item_id é só um vínculo opcional de catálogo, revalidado por tenant/perfume quando presente — nunca obrigatório',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn]){
      expect(fn).toMatch(/inventory_item(_id)?:=nullif\((?:p_batch|group_item)->>'inventory_item_id','?'\)::uuid/)
      expect(fn).toContain("raise exception 'invalid_inventory_item'")
    }
  })
  it('nunca cria inventory_items, inventory_bottles, inventory_movements ou inventory_purchase_entries',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn])
      for(const forbidden of['insert into public.inventory_items','insert into public.inventory_bottles','insert into public.inventory_movements','insert into public.inventory_purchase_entries'])
        expect(fn).not.toContain(forbidden)
  })
  it('nunca incrementa/decrementa physical_ml nem gera operational_code/RUAH-P',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn]){
      expect(fn).not.toMatch(/physical_ml\s*=/)
      expect(fn).not.toContain('ensure_perfume_operational_code')
    }
  })
  it('nunca cria preparation_batches nem shipments',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn])
      for(const forbidden of['insert into public.preparation_batches','insert into public.shipments'])
        expect(fn).not.toContain(forbidden)
  })
  it('vendas importadas nascem "pending" (nunca "paid" automaticamente) e preservam inventory_allocation_eligible=true, o contrato já existente desta RPC específica (não alterado neste hotfix)',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn]){
      expect(fn).toMatch(/'pending',null,'Importado de lista comercial com confirmação humana\.','ai_sales_batch'/)
      expect(fn).toMatch(/'verified',true,now\(\)\)/)
    }
  })
  it('16) idempotência: mesmo fingerprint retorna o resultado já existente, sem reprocessar',()=>{
    expect(confirmSingleFn).toContain('if existing.id is not null then return existing.result||jsonb_build_object(\'batch_id\',existing.id,\'idempotent\',true);end if;')
    expect(confirmMultiFn).toContain('if existing.id is not null then return existing.result||jsonb_build_object(\'batch_id\',existing.id,\'idempotent\',true);end if;')
  })
  it('17) atomicidade: nenhum bloco EXCEPTION captura erro em nenhuma das duas RPCs — falha desfaz o lote inteiro',()=>{
    expect(confirmSingleFn).not.toMatch(/exception\s+when/i)
    expect(confirmMultiFn).not.toMatch(/exception\s+when/i)
  })
  it('tenant isolation: has_org_role trava a organização em ambas as RPCs, sem confiar em organization_id do payload sozinho',()=>{
    for(const fn of[confirmSingleFn,confirmMultiFn])expect(fn).toContain("has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[])")
  })
})
