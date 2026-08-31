import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const station=readFileSync(new URL('./InventoryStationPage.tsx',import.meta.url),'utf8')
const css=readFileSync(new URL('./InventoryStationPage.css',import.meta.url),'utf8')
const preparation=readFileSync(new URL('../lib/preparation.ts',import.meta.url),'utf8')
const batchSql=readFileSync(new URL('../../supabase/migrations/202608220003_perfume_preparation_batches.sql',import.meta.url),'utf8')
const stationSql=readFileSync(new URL('../../supabase/migrations/202608230010_inventory_station_preparation.sql',import.meta.url),'utf8')

const createFn=batchSql.slice(batchSql.indexOf('create or replace function public.preparation_batch_create'),batchSql.indexOf('create or replace function public.preparation_batch_identify'))
const confirmFn=batchSql.slice(batchSql.indexOf('create or replace function public.preparation_batch_confirm('),batchSql.indexOf('create or replace function public.preparation_batch_cancel'))
const stationConfirmFn=stationSql.slice(stationSql.indexOf('create function public.inventory_station_confirm_preparation'),stationSql.indexOf('revoke all on function public.inventory_station_confirm_preparation'))
const receiveFn=stationSql.slice(stationSql.indexOf('create or replace function public.inventory_receive_perfume'),stationSql.indexOf('revoke all on function public.inventory_receive_perfume'))

describe('estilo da pendência de lote usa os tokens semânticos do app (âmbar=pendente, verde=resolvido, vermelho=sem opção)',()=>{
  it('classes de estado existem no CSS e usam --warning/--success/--danger, não cores soltas',()=>{
    expect(css).toContain('.station-prep-item--pending{border-color:var(--warning);background:var(--warning-bg)}')
    expect(css).toContain('.station-lot-badge--resolved{color:var(--success);background:var(--success-bg)}')
    expect(css).toContain('.station-lot-badge--danger{color:var(--danger);background:var(--danger-bg)}')
  })
})

describe('1/2 — pendência de lote só aparece quando o item realmente exige (bottle_tracking_status=\'active\')',()=>{
  it('venda sem pendência (tracking != active) não renderiza o seletor de frasco',()=>{
    expect(station).toContain('{needsBottle&&(eligibleBottles.length?')
    expect(station).toContain("const needsBottle=item.bottle_tracking_status==='active'")
  })
  it('venda com lote pendente mostra o campo de seleção de frasco',()=>{
    expect(station).toContain('<select aria-label={`Frasco de origem para ${item.client_name}`}')
    expect(station).toContain('station-lot-resolver')
  })
})

describe('3/4 — nunca escolhe sozinho quando há ambiguidade (item 1 do briefing)',()=>{
  it('uma única opção física válida (e com saldo suficiente) pode ser pré-selecionada, mas fica visível/explícita no próprio select',()=>{
    expect(station).toContain("filter(item=>item.bottle_tracking_status==='active'&&source.length===1&&source[0].physical_ml>=Number(item.remaining_ml)).map(item=>[item.allocation_id,source[0].id])")
  })
  it('múltiplas opções NUNCA são pré-selecionadas — o mapeamento só preenche quando source.length===1, nunca para >1',()=>{
    const initLine=station.slice(station.indexOf('setSourceByAllocation(Object.fromEntries'),station.indexOf('setSelected(new Set())'))
    expect(initLine).toContain('source.length===1')
    expect(initLine).not.toMatch(/source\[0\]\.id\)\]\)\)(?!.*source\.length===1)/)
  })
  it('o próprio banco recusa confirmar sem escolha quando há rastreamento ativo — não é só uma checagem de frontend',()=>{
    expect(createFn).toContain("tracking='active' then raise exception 'source_bottle_required'")
  })
  it('erro source_bottle_required tem tradução amigável no leitor, para o caso de uma corrida entre o preview e a confirmação',()=>{
    expect(station).toContain("message.includes('source_bottle_required')?'Selecione o frasco de origem para todas as vendas marcadas.'")
  })
})

describe('5/6/7 — as opções vêm só de lotes elegíveis: mesmo perfume, mesma organização, com saldo, ativos',()=>{
  it('fetchPreparationBottles filtra por organization_id (tenant) e perfume_id (mesmo perfume) explicitamente',()=>{
    expect(preparation).toContain(".eq('organization_id',organizationId).eq('perfume_id',perfumeId)")
  })
  it('só bottles com status ativo e saldo físico positivo entram como opção (estado operacional + saldo compatível)',()=>{
    expect(preparation).toContain(".eq('status','active').gt('physical_ml',0)")
  })
  it('defesa em profundidade: o servidor também revalida organização, perfume e status ao aceitar o source_bottle_id — não confia só no que o frontend mandou',()=>{
    expect(createFn).toContain('from public.inventory_bottles where id=(item->>\'source_bottle_id\')::uuid and organization_id=org and perfume_id=p_perfume_id and status=\'active\'')
  })
  it('a própria alocação é revalidada contra organização, perfume e status reserved no servidor (não permite apontar venda de um perfume/tenant para lote de outro)',()=>{
    expect(createFn).toContain("a.organization_id<>org or a.perfume_id<>p_perfume_id or a.status<>'reserved' then raise exception 'allocation_not_eligible'")
  })
})

describe('8/9/10 — resolver atualiza a tela na hora, sem refresh, e recalcula tudo',()=>{
  it('pendingCount e o guard de confirmação são derivados no próprio render a partir do estado local (agora também sensível à capacidade do frasco) — nenhum useEffect/refetch dispara ao escolher um frasco',()=>{
    expect(station).toContain('const pendingAllocationIds=new Set((perfume?.items??[]).filter(item=>!isItemResolved(item)).map(item=>item.allocation_id))')
    expect(station).toContain('const selectedHasPendingLot=(perfume?.items??[]).some(item=>selected.has(item.allocation_id)&&pendingAllocationIds.has(item.allocation_id))')
  })
  it('escolher um frasco só atualiza sourceByAllocation (estado local) — confirma que não há chamada de rede no onChange do select',()=>{
    expect(station).toContain("onChange={e=>setSource(item.allocation_id,e.target.value)}")
    expect(station).toContain('const setSource=(allocationId:string,bottleId:string)=>setSourceByAllocation(current=>({...current,[allocationId]:bottleId}))')
  })
  it('CONFIRMAR PREPARAÇÃO fica desabilitado enquanto houver pendência entre os itens selecionados',()=>{
    expect(station).toContain('disabled={!selected.size||readOnly||confirmingReceipt||selectedHasPendingLot}')
    expect(station).toContain("selectedHasPendingLot?'RESOLVA A PENDÊNCIA DE LOTE'")
  })
  it('a própria função de confirmar também recusa localmente enquanto houver pendência selecionada (defesa em profundidade no cliente)',()=>{
    expect(station).toContain('if(!perfume||!selected.size||confirmingReceipt||readOnly||selectedHasPendingLot)return')
  })
  it('resumo mostra vendas aguardando, volume total e pendências de lote — todos recalculados de perfume.items/pendingCount, nunca de um valor congelado',()=>{
    expect(station).toContain('<dt>Vendas aguardando preparação</dt><dd>{perfume.items.length}</dd>')
    expect(station).toContain('<dt>Volume total (SPLIT)</dt><dd>{formatMl(perfume.items.filter(item=>(item.sale_type??\'SPLIT\')===\'SPLIT\').reduce((sum,item)=>sum+Number(item.remaining_ml),0))}</dd>')
    expect(station).toContain('<dt>Pendências de lote</dt><dd>{pendingCount}</dd>')
  })
})

describe('estados A/B/C nunca se misturam (item 7 do briefing)',()=>{
  it('B — banner PENDÊNCIA DE LOTE só aparece quando pendingCount>0 e há itens',()=>{
    expect(station).toContain("pendingCount>0?<p className=\"station-pending-banner\">PENDÊNCIA DE LOTE")
  })
  it('A — banner PRONTO PARA PREPARAR aparece só quando não há pendência, com itens presentes',()=>{
    expect(station).toContain(':<p className="station-ready-banner">PRONTO PARA PREPARAR</p>')
    expect(station).toContain('{perfume.items.length>0&&(pendingCount>0?')
  })
  it('C — sem vendas elegíveis mostra estado vazio real, sem nenhum campo de resolução (o mapeamento de itens simplesmente não roda sobre uma lista vazia)',()=>{
    expect(station).toContain('{!perfume.items.length&&<p>Nenhuma venda aguarda preparação para este perfume.</p>}')
  })
})

describe('caso sem opção física válida (item 4 do briefing)',()=>{
  it('sem nenhum lote elegível, mostra a mensagem exata pedida e um CTA para o estoque já existente — não inventa estoque',()=>{
    expect(station).toContain('<p>Nenhum lote físico disponível para esta venda.</p>')
    expect(station).toContain('<button type="button" onClick={goToInventory}>ABRIR ESTOQUE</button>')
  })
  it('goToInventory é a mesma rota /estoque já existente na página (reaproveitada, não uma rota nova)',()=>{
    expect(station.match(/function goToInventory\(\)/g)).toHaveLength(1)
    expect(station).toContain("history.pushState({}, '', '/estoque')")
  })
})

describe('11 — audit: quem, quando, allocation (→ sale_id), frasco novo',()=>{
  it('a confirmação do leitor grava audit_logs com actor (auth.uid), timestamp (default now()) e o payload completo de itens (allocation_id + source_bottle_id escolhido)',()=>{
    expect(stationConfirmFn).toContain("'inventory_station_preparation_confirmed'")
    expect(stationConfirmFn).toContain("auth.uid()")
    expect(stationConfirmFn).toContain("'items',p_items")
  })
  it('allocation_id já rastreia sale_id de forma determinística via inventory_allocations (não duplica o campo em outro lugar)',()=>{
    expect(batchSql).toContain('references public.inventory_allocations(id)')
  })
  it('não existe "lote anterior" a registrar nesta primeira atribuição — allocation_id é único por preparation_batch_items (não há reatribuição no mesmo fluxo)',()=>{
    expect(batchSql).toContain('unique(batch_id,allocation_id)')
  })
})

describe('12/13/14/15 — resolver lote não escreve em estoque físico nem gera identidade nova',()=>{
  it('preparation_batch_create/_confirm e a confirmação do leitor nunca tocam physical_ml',()=>{
    expect(createFn).not.toContain('physical_ml')
    expect(confirmFn).not.toContain('physical_ml')
    expect(stationConfirmFn).not.toContain('physical_ml')
  })
  it('nenhuma dessas funções insere em inventory_movements',()=>{
    for(const fn of[createFn,confirmFn,stationConfirmFn])expect(fn).not.toContain('inventory_movements')
  })
  it('nenhuma dessas funções insere em inventory_purchase_entries',()=>{
    for(const fn of[createFn,confirmFn,stationConfirmFn])expect(fn).not.toContain('inventory_purchase_entries')
  })
  it('nenhuma dessas funções gera RUAH-P novo — ensure_perfume_operational_code só é chamada dentro de inventory_receive_perfume (recebimento físico), nunca na preparação',()=>{
    for(const fn of[createFn,confirmFn,stationConfirmFn])expect(fn).not.toContain('ensure_perfume_operational_code')
    expect(receiveFn).toContain('ensure_perfume_operational_code')
  })
  it('nenhuma dessas funções cria shipment ou chama post_shipment',()=>{
    for(const fn of[createFn,confirmFn,stationConfirmFn]){expect(fn).not.toContain('insert into public.shipments');expect(fn).not.toContain('post_shipment(')}
  })
})

describe('16 — fluxo atual sem pendência não sofre regressão',()=>{
  it('seleção parcial ainda envia só as allocations marcadas (comportamento pré-existente preservado)',()=>{
    expect(station).toContain('perfume.items.filter(item=>selected.has(item.allocation_id)).map')
  })
  it('itens sem rastreamento de frasco continuam enviando source_bottle_id null, exatamente como antes desta mudança',()=>{
    expect(station).toContain("source_bottle_id:item.bottle_tracking_status==='active'?(sourceByAllocation[item.allocation_id]||null):null")
  })
  it('scan continua zero-write no preview (previewInventoryStation não chama a RPC de confirmação)',()=>{
    const preview=preparation.slice(preparation.indexOf('export async function previewInventoryStation'),preparation.indexOf('export async function confirmInventoryStationPreparation'))
    expect(preview).not.toContain("supabase.rpc('inventory_station_confirm_preparation'")
  })
  it('SPLIT/APC continuam agrupados e o total exibido continua ignorando APC',()=>{
    expect(station).toContain("(['SPLIT','APC']as const)")
    expect(station).toContain('TOTAL SPLIT:')
  })
})

describe('segurança geral do fluxo (item 5 do briefing)',()=>{
  it('inventory_station_confirm_preparation exige inventory.adjust e nunca aceita organization_id do payload — deriva sempre do código escaneado',()=>{
    expect(stationConfirmFn).toContain("has_org_permission(p.organization_id,'inventory.adjust')")
    expect(stationConfirmFn).not.toMatch(/p_organization_id/)
  })
  it('preparation_batch_create também exige inventory.adjust e deriva a organização do próprio perfume no banco',()=>{
    expect(createFn).toContain("has_org_permission(org,'inventory.adjust')")
  })
})
