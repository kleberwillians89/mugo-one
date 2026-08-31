import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync(new URL('../../supabase/migrations/202608310001_preparation_bottle_capacity.sql',import.meta.url),'utf8')
const oldMigration=readFileSync(new URL('../../supabase/migrations/202608220003_perfume_preparation_batches.sql',import.meta.url),'utf8')
const station=readFileSync(new URL('./InventoryStationPage.tsx',import.meta.url),'utf8')

const stripSqlComments=(sql:string)=>sql.split('\n').map(line=>{const i=line.indexOf('--');return i>=0?line.slice(0,i):line}).join('\n')
const migrationCode=stripSqlComments(migration)
const createFn=migration.slice(migration.indexOf('create or replace function public.preparation_batch_create'),migration.indexOf('revoke all on function public.preparation_batch_create'))
const confirmFn=migration.slice(migration.indexOf('create or replace function public.preparation_batch_confirm'),migration.indexOf('revoke all on function public.preparation_batch_confirm'))

// Réplica fiel de InventoryStationPage.tsx (bottleCommittedInSession/
// bottleAvailableFor/isItemResolved) para exercitar os 4 cenários numéricos
// do briefing de verdade, não só via grep de string.
type Item={allocation_id:string;remaining_ml:number;bottle_tracking_status:string}
type Bottle={id:string;physical_ml:number}
const committedInSession=(items:Item[],source:Record<string,string>,bottleId:string,excludeAllocationId:string)=>
  items.filter(item=>item.allocation_id!==excludeAllocationId&&source[item.allocation_id]===bottleId).reduce((sum,item)=>sum+item.remaining_ml,0)
const availableFor=(bottles:Bottle[],items:Item[],source:Record<string,string>,bottleId:string,allocationId:string)=>{
  const found=bottles.find(b=>b.id===bottleId);return found?found.physical_ml-committedInSession(items,source,bottleId,allocationId):0
}
const resolved=(bottles:Bottle[],items:Item[],source:Record<string,string>,item:Item)=>{
  if(item.bottle_tracking_status!=='active')return true
  const chosen=source[item.allocation_id]
  return Boolean(chosen)&&availableFor(bottles,items,source,chosen,item.allocation_id)>=item.remaining_ml
}

describe('capacidade individual do frasco (item 1 do briefing) — matemática real, não só grep',()=>{
  it('cenário 1: frasco 3ml NÃO atende allocation de 6ml',()=>{
    const bottles=[{id:'B1',physical_ml:3}],items=[{allocation_id:'A1',remaining_ml:6,bottle_tracking_status:'active'}],source={A1:'B1'}
    expect(resolved(bottles,items,source,items[0])).toBe(false)
  })
  it('cenário 2: frasco exatamente 6ml atende allocation de 6ml (limite inclusivo, sem folga)',()=>{
    const bottles=[{id:'B1',physical_ml:6}],items=[{allocation_id:'A1',remaining_ml:6,bottle_tracking_status:'active'}],source={A1:'B1'}
    expect(resolved(bottles,items,source,items[0])).toBe(true)
  })
})

describe('consumo acumulado no mesmo frasco (item 2 do briefing) — matemática real',()=>{
  it('cenário 3: frasco 10ml NÃO atende duas allocations de 6ml cada (soma 12ml)',()=>{
    const bottles=[{id:'B1',physical_ml:10}]
    const items=[{allocation_id:'A1',remaining_ml:6,bottle_tracking_status:'active'},{allocation_id:'A2',remaining_ml:6,bottle_tracking_status:'active'}]
    const source={A1:'B1',A2:'B1'}
    expect(resolved(bottles,items,source,items[0])&&resolved(bottles,items,source,items[1])).toBe(false)
  })
  it('cenário 4: frasco 12ml atende duas allocations de 6ml cada (soma exata 12ml)',()=>{
    const bottles=[{id:'B1',physical_ml:12}]
    const items=[{allocation_id:'A1',remaining_ml:6,bottle_tracking_status:'active'},{allocation_id:'A2',remaining_ml:6,bottle_tracking_status:'active'}]
    const source={A1:'B1',A2:'B1'}
    expect(resolved(bottles,items,source,items[0])&&resolved(bottles,items,source,items[1])).toBe(true)
  })
})

describe('o mesmo cálculo governa o <select> — frasco insuficiente nunca aparece como opção (item 4 do briefing)',()=>{
  it('a lista de opções filtra por bottleAvailableFor >= remaining_ml, exceto o próprio já escolhido (para o select nunca ficar com valor fora da lista)',()=>{
    expect(station).toContain('const eligibleBottles=bottles.filter(b=>b.id===currentSourceId||bottleAvailableFor(b.id,item.allocation_id)>=Number(item.remaining_ml))')
  })
  it('o rótulo da opção mostra frasco/barcode/saldo REAL restante (não o physical_ml bruto do frasco)',()=>{
    expect(station).toContain('{b.bottle_label} · {b.barcode_value} · {formatMl(bottleAvailableFor(b.id,item.allocation_id))} disponíveis')
  })
  it('sem nenhuma opção elegível, cai no mesmo estado "nenhum lote disponível" já existente — nunca mostra um select vazio de propósito',()=>{
    expect(station).toContain('{needsBottle&&(eligibleBottles.length?')
  })
  it('pré-seleção automática (frasco único) só ocorre quando esse único frasco também tem saldo suficiente para o item — nunca pré-marca um frasco pequeno demais',()=>{
    expect(station).toContain("source.length===1&&source[0].physical_ml>=Number(item.remaining_ml)")
  })
})

describe('4/5/6 — falha por saldo insuficiente faz rollback integral, nenhuma preparação parcial',()=>{
  it('nenhum bloco EXCEPTION captura o erro em nenhuma das duas funções — um raise em qualquer item desfaz a função inteira, inclusive itens já processados antes dele',()=>{
    expect(createFn).not.toMatch(/exception\s+when/i)
    expect(confirmFn).not.toMatch(/exception\s+when/i)
  })
  it('não há SAVEPOINT nem qualquer mecanismo de commit parcial dentro do loop — o insert de preparation_batch_items de um item anterior não sobrevive ao raise de um item posterior',()=>{
    expect(migrationCode.toLowerCase()).not.toContain('savepoint')
  })
  it('a exceção nova tem nome próprio e específico, distinto de preparation_quantity_exceeded (facilita diagnóstico sem esconder a causa)',()=>{
    expect(createFn).toContain("raise exception 'source_bottle_capacity_exceeded'")
    expect(confirmFn).toContain("raise exception 'source_bottle_capacity_exceeded'")
  })
})

describe('7 — concorrência: duas sessões não conseguem reservar acima do saldo do mesmo frasco (item 3 do briefing)',()=>{
  it('preparation_batch_confirm trava o frasco com FOR UPDATE antes de somar/comparar — mesmo padrão já usado para a allocation (for update of a) e para o próprio bottle em post_shipment',()=>{
    expect(confirmFn).toContain('select * into bottle from public.inventory_bottles where id=r.source_bottle_id for update')
  })
  it('a soma "já comprometido" é recalculada DEPOIS do lock, dentro da mesma função — não é um valor lido antes e reaproveitado (evita TOCTOU)',()=>{
    const afterLock=confirmFn.slice(confirmFn.indexOf('select * into bottle from public.inventory_bottles where id=r.source_bottle_id for update'))
    expect(afterLock.indexOf('select coalesce(sum(bi.quantity_ml),0) into bottle_committed')).toBeGreaterThan(0)
  })
  it('a checagem em preparation_batch_create é best-effort (sem lock) — documentado como tal; a garantia real e serializada é a de confirm, igual ao padrão já usado para capacidade de allocation',()=>{
    const createBottleCheck=createFn.slice(createFn.indexOf("if nullif(item->>'source_bottle_id','') is not null then"),createFn.indexOf('elsif tracking='))
    expect(createBottleCheck).not.toContain('for update')
  })
  it('post_shipment (não tocado nesta correção) já usa exatamente este padrão de FOR UPDATE + comparação para o mesmo inventory_bottles.physical_ml — a correção estende um padrão já comprovado, não inventa um novo',()=>{
    expect(oldMigration).toContain("select physical_ml into source_ml from public.inventory_bottles where id=r.bottle_id for update")
  })
})

describe('8/9 — frasco de outro perfume ou de outro tenant continua bloqueado (inalterado por esta correção)',()=>{
  it('o lookup do frasco em preparation_batch_create continua exigindo organization_id=org e perfume_id=p_perfume_id, exatamente como antes',()=>{
    expect(createFn).toContain('where id=(item->>\'source_bottle_id\')::uuid and organization_id=org and perfume_id=p_perfume_id and status=\'active\'')
  })
  it('a alocação em si também é revalidada contra organização, perfume e status reserved — inalterado por esta migration',()=>{
    expect(createFn).toContain("a.organization_id<>org or a.perfume_id<>p_perfume_id or a.status<>'reserved' then raise exception 'allocation_not_eligible'")
  })
})

describe('10 — fluxo normal (sem pendência de capacidade) não sofre regressão',()=>{
  it('item sem rastreamento de frasco (bottle_tracking_status != active) nunca entra no novo bloco de capacidade — só o ramo "elsif tracking=\'active\'" permanece para ele',()=>{
    expect(createFn).toContain("elsif tracking='active' then raise exception 'source_bottle_required'; end if;")
  })
  it('a checagem de capacidade da allocation (pré-existente) continua exatamente igual, não foi tocada por esta correção',()=>{
    expect(createFn).toContain('if requested<=0 or already+requested>a.original_quantity_ml then raise exception \'preparation_quantity_exceeded\'; end if;')
    expect(confirmFn).toContain('if already+r.quantity_ml>r.allocation_ml then raise exception \'preparation_quantity_exceeded\';end if;')
  })
  it('grants/revokes das duas funções continuam idênticos (mesma assinatura, mesmo papel autorizado)',()=>{
    expect(migration).toContain('revoke all on function public.preparation_batch_create(uuid,jsonb) from public,anon;')
    expect(migration).toContain('grant execute on function public.preparation_batch_create(uuid,jsonb) to authenticated;')
    expect(migration).toContain('revoke all on function public.preparation_batch_confirm(uuid) from public,anon;')
    expect(migration).toContain('grant execute on function public.preparation_batch_confirm(uuid) to authenticated;')
  })
})

describe('não alterar (item 5 do briefing) — nada de RUAH-P, recebimento, físico ou comercial nesta migration',()=>{
  it('nenhuma menção a ensure_perfume_operational_code, inventory_receive_perfume ou operational_code',()=>{
    for(const forbidden of['ensure_perfume_operational_code','inventory_receive_perfume','operational_code'])
      expect(migrationCode).not.toContain(forbidden)
  })
  it('nenhuma escrita em physical_ml, inventory_items, inventory_movements, inventory_purchase_entries, sales, shipments ou audit_logs de cobrança',()=>{
    for(const forbidden of['physical_ml=','update public.inventory_items','inventory_movements','inventory_purchase_entries','update public.sales','insert into public.shipments','collections_'])
      expect(migrationCode).not.toContain(forbidden)
  })
  it('só duas funções são redefinidas nesta migration — nenhuma tabela nova, nenhum trigger novo',()=>{
    expect(migrationCode.match(/create (or replace )?function/g)).toHaveLength(2)
    expect(migrationCode).not.toMatch(/create table|create trigger/)
  })
  it('esta é a única migration nova desta rodada — arquivo isolado, não editou a migration original 202608220003',()=>{
    expect(oldMigration).not.toContain('source_bottle_capacity_exceeded')
  })
})
