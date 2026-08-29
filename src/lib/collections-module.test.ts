import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync(new URL('../../supabase/migrations/202608290004_collections_module.sql',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const routing=readFileSync(new URL('../routing.ts',import.meta.url),'utf8')
const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8')
const clientDetails=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const initialSchema=readFileSync(new URL('../../supabase/migrations/202607290001_initial_schema.sql',import.meta.url),'utf8')
const auditRls=readFileSync(new URL('../../supabase/migrations/202607290002_rls_and_audit.sql',import.meta.url),'utf8')
const operatorProtection=readFileSync(new URL('../../supabase/migrations/202607300010_period_delivery_reports_ai.sql',import.meta.url),'utf8')
const allocationSyncLatest=readFileSync(new URL('../../supabase/migrations/202608230011_fix_davi_sale_original_allocation_quantity.sql',import.meta.url),'utf8')

const between=(text:string,start:string,end:string)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)))
// Comentários explicativos do SQL citam de propósito o que NÃO é tocado
// (ex.: "sem inventory_items, physical_ml, operational_code…") — para não
// confundir prosa com código executável, os testes de invariante escaneiam
// só o SQL sem comentários de linha.
const stripSqlComments=(sql:string)=>sql.split('\n').map(line=>{const i=line.indexOf('--');return i>=0?line.slice(0,i):line}).join('\n')
const migrationCode=stripSqlComments(migration)
const pendingFn=between(migration,'create function public.collections_pending_sales','create function public.collections_log_message_copied')
const logFn=between(migration,'create function public.collections_log_message_copied','create function public.collections_register_payment')
const paymentFn=between(migration,'create function public.collections_register_payment','commit;')

describe('Cobranças — fonte canônica é public.sales (item 1)',()=>{
  it('não cria uma segunda tabela de vendas/pendências — só collection_events (histórico de contato)',()=>{
    expect(migration.match(/create table/g)).toHaveLength(1)
    expect(migration).toContain('create table public.collection_events')
  })
  it('não inventa valores de payment_status: só referencia os quatro já existentes',()=>{
    expect(migration).not.toMatch(/create type|alter type/i)
    for(const literal of ["'pending'","'paid'","'cancelled'"])expect(migration).toContain(literal)
  })
  it('pendência = payment_status=\'pending\' — pago não aparece, cancelado não aparece como dívida',()=>{
    expect(pendingFn).toContain("s.payment_status='pending'")
    expect(pendingFn).not.toContain("'cancelled'")
    expect(pendingFn).not.toContain("'paid'")
  })
  it('não infere vencimento (VENCIDOS) de shipping_deadline ou qualquer campo não financeiro',()=>{
    expect(migration).not.toMatch(/shipping_deadline/)
    expect(migration).not.toContain('overdue')
  })
})

describe('Cobranças — RPC collections_pending_sales (busca, agrupável por cliente, histórico de mensagem copiada)',()=>{
  it('devolve client_number, client_name, total por linha e histórico de MENSAGEM COPIADA por cliente — nomes que não afirmam "cobrança confirmada"',()=>{
    expect(pendingFn).toContain('client_number integer,client_name text')
    expect(pendingFn).toContain('last_message_copied_at timestamptz,message_copied_count integer')
    expect(pendingFn).not.toContain('last_collection_at')
    expect(pendingFn).not.toContain('collection_count')
  })
  it('busca cobre cliente, número do cliente e perfume',()=>{
    expect(pendingFn).toContain('c.name ilike')
    expect(pendingFn).toContain('c.client_number::text ilike')
    expect(pendingFn).toContain('p.full_name_raw ilike')
  })
  it('exige sales.view e isola por tenant',()=>{
    expect(pendingFn).toContain("public.has_org_permission(s.organization_id,'sales.view')")
    expect(pendingFn).toContain('s.organization_id in(select public.current_user_org_ids())')
    expect(pendingFn).toContain('s.deleted_at is null')
  })
  it('conta quantas vezes a mensagem foi copiada só por event_type=\'message_copied\' — nunca infere envio/leitura/contato',()=>{
    expect(pendingFn).toContain("e.event_type='message_copied'")
  })
})

describe('Cobranças — registrar cobrança nunca afirma envio de WhatsApp (item 6)',()=>{
  it('collection_events só grava message_copied nesta versão',()=>{
    expect(logFn).toContain("values(c.organization_id,c.id,'message_copied',auth.uid()")
  })
  it('nenhum texto do módulo afirma que o WhatsApp foi enviado',()=>{
    for(const forbidden of ['whatsapp_sent','mensagem enviada','enviado por whatsapp','sent_via_whatsapp'])
      expect((migration+records).toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
  it('log de cobrança exige sales.view e isola por tenant',()=>{
    expect(logFn).toContain("public.has_org_permission(c.organization_id,'sales.view')")
    expect(logFn).toContain('organization_id in(select public.current_user_org_ids())')
  })
})

describe('Cobranças — registrar pagamento (item 7): transacional, sale.id preservado, idempotente',()=>{
  it('aceita um array de vendas — cobre pagamento de 1 ou várias de uma vez',()=>{
    expect(paymentFn).toContain('p_sale_ids uuid[]')
    expect(paymentFn).toContain('for sale_row in')
  })
  it('atualiza só payment_status/paid_at/payment_method/notes — nunca reatribui id',()=>{
    const setClause=between(paymentFn,'update public.sales set','where id=sale_row.id')
    expect(setClause).toContain('payment_status=\'paid\',\n      paid_at=p_paid_at,\n      payment_method=clean_method')
    expect(setClause).not.toMatch(/\bid\s*=/)
  })
  it('alvo é sempre \'paid\' — nenhum enum novo, nenhum parâmetro externo controla o status final',()=>{
    expect(paymentFn).not.toContain('p_payment_status')
  })
  it('reenviar a mesma seleção com a mesma data/forma não duplica (idempotência) — vendas já pagas iguais são puladas',()=>{
    expect(paymentFn).toContain('skipped_ids:=array_append(skipped_ids,sale_row.id)')
    expect(paymentFn).toContain('continue;')
  })
  it('reenviar com dado divergente sobre venda já paga é rejeitado, não sobrescreve silenciosamente',()=>{
    expect(paymentFn).toContain("raise exception 'sale_already_paid:%',sale_row.id")
  })
  it('venda cancelada não pode ser quitada',()=>{
    expect(paymentFn).toContain("if sale_row.payment_status='cancelled' then raise exception 'sale_cancelled:%',sale_row.id")
  })
  it('exige sales.edit por linha (tenant isolation real, não um único check global) e rejeita seleção cross-tenant',()=>{
    expect(paymentFn).toContain("public.has_org_permission(sale_row.organization_id,'sales.edit')")
    expect(paymentFn).toContain('organization_id in(select public.current_user_org_ids())')
    expect(paymentFn).toContain("if array_length(resolved_ids,1) is distinct from array_length(ids,1) then raise exception 'sale_not_found'")
  })
  it('grava audit_logs com quem, quando, sale.id, status anterior/novo, data e forma',()=>{
    expect(paymentFn).toContain('insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)')
    expect(paymentFn).toContain("actor_id,action,entity_type,entity_id,metadata)\n    values(sale_row.organization_id,auth.uid(),'collections_payment_registered'")
    expect(paymentFn).toContain("'status_before',sale_row.payment_status,'status_after',after_row.payment_status")
    expect(paymentFn).toContain("'paid_at',after_row.paid_at,'payment_method',after_row.payment_method")
  })
})

describe('Cobranças — invariante absoluta de estoque (item 10): nenhuma escrita física',()=>{
  it('o módulo inteiro nunca escreve em tabelas/campos de estoque físico',()=>{
    for(const forbidden of [
      'insert into public.inventory_items','insert into public.inventory_movements','insert into public.inventory_purchase_entries',
      'physical_ml=','operational_code','RUAH-P','insert into public.shipments','insert into public.preparation_batches','inventory_allocations',
    ])expect(migrationCode).not.toContain(forbidden)
  })
  it('a função de pagamento só grava em public.sales e public.audit_logs',()=>{
    const updates=paymentFn.match(/update public\.\w+/g)??[]
    const inserts=paymentFn.match(/insert into public\.\w+/g)??[]
    expect(new Set(updates)).toEqual(new Set(['update public.sales']))
    expect(new Set(inserts)).toEqual(new Set(['insert into public.audit_logs']))
  })
})

describe('Cobranças — permissões: sem sales.edit não é possível registrar pagamento (item 2/11)',()=>{
  it('grants: RPCs de leitura pedem sales.view, pagamento pede sales.edit',()=>{
    expect(pendingFn).toContain("'sales.view'")
    expect(logFn).toContain("'sales.view'")
    expect(paymentFn).toContain("'sales.edit'")
  })
  it('escrita direta na tabela de eventos é bloqueada — só via RPC security definer',()=>{
    expect(migration).toContain('revoke insert,update,delete on public.collection_events from authenticated')
  })
})

describe('Cobranças — records.ts expõe as três RPCs com nomes canônicos',()=>{
  it('fetchCollectionsPending chama collections_pending_sales',()=>{expect(records).toContain("supabase!.rpc('collections_pending_sales'")})
  it('logCollectionMessageCopied chama collections_log_message_copied',()=>{expect(records).toContain("supabase!.rpc('collections_log_message_copied'")})
  it('registerCollectionPayment chama collections_register_payment',()=>{expect(records).toContain("supabase!.rpc('collections_register_payment'")})
})

describe('Cobranças — rota, menu e permissões de página (item 2)',()=>{
  it('rota /cobrancas existe e exige sales.view para ver a página',()=>{
    expect(routing).toContain("'Cobranças':'/cobrancas'")
    expect(routing).toContain("'Cobranças':['sales.view']")
  })
  it('aparece no menu principal',()=>{expect(routing).toMatch(/label:\s*'Cobranças'/)})
  it('App.tsx roteia para CobrancasPage',()=>{expect(app).toContain("if (page === 'Cobranças') return <CobrancasPage/>")})
})

describe('Cobranças — cruzamento com o resto do CRM (item 9): sem segunda verdade financeira',()=>{
  it('Davi Excel e Cliente 360 continuam lendo payment_status direto de public.sales — nada foi duplicado para eles enxergarem "paid"',()=>{
    expect(clientDetails).toContain('sale.payment_status')
    expect(migration).not.toMatch(/create (materialized )?view/i)
  })
})

// ===== PREFLIGHT antes de aplicar 202608290004 =====

describe('PREFLIGHT item 2 — SECURITY DEFINER, search_path, revoke/grant, auth.uid(), tenant isolation',()=>{
  const rpcs=[{name:'collections_pending_sales',body:pendingFn,signature:'collections_pending_sales(text)'},
    {name:'collections_log_message_copied',body:logFn,signature:'collections_log_message_copied(uuid,jsonb)'},
    {name:'collections_register_payment',body:paymentFn,signature:'collections_register_payment(uuid[],date,text,text)'}]
  it.each(rpcs)('$name é SECURITY DEFINER com search_path fechado em public',({body})=>{
    expect(body).toMatch(/security definer set search_path=public/)
  })
  it.each(rpcs)('$name: EXECUTE revogado de public/anon e concedido só a authenticated',({signature})=>{
    expect(migration).toContain(`revoke all on function public.${signature} from public,anon;`)
    expect(migration).toContain(`grant execute on function public.${signature} to authenticated;`)
  })
  it('collections_log_message_copied e collections_register_payment gravam auth.uid() como autor (created_by/actor_id) — nunca um id vindo do payload',()=>{
    expect(logFn).toContain('created_by,metadata)\n  values(c.organization_id,c.id,\'message_copied\',auth.uid()')
    expect(paymentFn).toContain("values(sale_row.organization_id,auth.uid(),'collections_payment_registered'")
    expect(migration).not.toMatch(/p_created_by|p_actor_id|p_user_id/)
  })
  it('collections_pending_sales não chama auth.uid() diretamente, mas delega 100% da autenticação a has_org_permission/current_user_org_ids — que por sua vez exigem auth.uid()',()=>{
    expect(pendingFn).not.toContain('auth.uid()')
    expect(pendingFn).toContain('public.current_user_org_ids()')
    expect(pendingFn).toContain('public.has_org_permission(')
    expect(initialSchema).toContain('select organization_id from public.organization_members where user_id = auth.uid();')
  })
  it('p_client_id é validado contra organização E permissão antes de qualquer insert (não confia no client_id sozinho)',()=>{
    const validation=between(logFn,'select * into c from public.clients','insert into public.collection_events')
    expect(validation).toContain('organization_id in(select public.current_user_org_ids())')
    expect(validation).toContain("if not public.has_org_permission(c.organization_id,'sales.view') then raise exception 'forbidden'")
  })
  it('cada p_sale_id é validado individualmente dentro do loop — não existe um único check global para o array inteiro',()=>{
    expect(paymentFn).toContain('for sale_row in')
    const loopBody=between(paymentFn,'loop','end loop;')
    expect(loopBody).toContain("if not public.has_org_permission(sale_row.organization_id,'sales.edit') then raise exception 'forbidden'")
  })
  it('nenhuma das 3 RPCs aceita organization_id do frontend — a organização é sempre derivada de client_id/sale_id no servidor',()=>{
    for(const signature of ['collections_pending_sales(p_search text default null)','collections_log_message_copied(p_client_id uuid,p_metadata jsonb default \'{}\'::jsonb)','collections_register_payment(\n  p_sale_ids uuid[],\n  p_paid_at date,\n  p_payment_method text,\n  p_notes text default null\n)'])
      expect(migration).toContain(signature)
    expect(migration).not.toMatch(/p_organization_id/)
    expect(records).not.toMatch(/collections_(pending_sales|log_message_copied|register_payment)'[^)]*organization/)
  })
})

describe('PREFLIGHT item 3 — triggers em public.sales: o que dispara quando payment_status muda',()=>{
  it('audit_sales (202607290002) audita toda escrita em sales automaticamente — inclusive as de Cobranças',()=>{
    expect(auditRls).toContain('create trigger audit_sales after insert or update or delete on public.sales for each row execute function public.audit_row_change();')
  })
  it('sync_sale_inventory_allocation (última redefinição, 202608230011) só cria/ajusta inventory_allocations e available_ml quando payment_status=\'paid\' E inventory_allocation_eligible=true — comportamento canônico pré-existente, não algo que Cobranças criou',()=>{
    expect(allocationSyncLatest).toContain("new.payment_status<>'paid' or not new.inventory_allocation_eligible")
    expect(allocationSyncLatest).toContain('update public.inventory_items set available_ml=available_ml-new.volume_ml')
    expect(allocationSyncLatest).toContain('insert into public.inventory_allocations(')
  })
  it('esse mesmo trigger NUNCA toca physical_ml, inventory_movements, inventory_purchase_entries, operational_code, shipments ou preparation_batches',()=>{
    for(const forbidden of ['physical_ml','inventory_movements','inventory_purchase_entries','operational_code','RUAH-P','insert into public.shipments','insert into public.preparation_batches'])
      expect(allocationSyncLatest).not.toContain(forbidden)
  })
  it('protect_operator_sale_changes (202607300010) bloqueia mudança de payment_status para member_role=\'operator\' — Cobranças herda essa trava, não abre exceção',()=>{
    expect(operatorProtection).toContain("if user_role='operator' and (")
    expect(operatorProtection).toContain('new.payment_status is distinct from old.payment_status')
    expect(operatorProtection).toContain("raise exception 'operator_shipping_only'")
  })
  it('a migration documenta essa interação explicitamente (não é uma descoberta silenciosa)',()=>{
    expect(migration).toContain('sync_sale_inventory_allocation')
    expect(migration).toContain('protect_operator_sale_changes')
    expect(migration).toContain('operator_shipping_only')
    expect(migration).toContain('insufficient_available_inventory')
  })
  it('collections_register_payment nunca desliga/ignora triggers (sem DISABLE TRIGGER, sem session_replication_role)',()=>{
    expect(migrationCode.toLowerCase()).not.toContain('disable trigger')
    expect(migrationCode.toLowerCase()).not.toContain('session_replication_role')
  })
  it('records.ts traduz os erros desses triggers em mensagens compreensíveis (operador, estoque insuficiente, alocação ativa)',()=>{
    expect(records).toContain("message.includes('operator_shipping_only')")
    expect(records).toContain("message.includes('insufficient_available_inventory')")
    expect(records).toContain("message.includes('sale_has_active_shipment_allocation')")
  })
})

describe('PREFLIGHT item 4 — payment RPC: atomicidade real, não só por convenção',()=>{
  it('nenhum bloco EXCEPTION captura erros — qualquer raise aborta a função inteira (nenhum pagamento parcial sobrevive)',()=>{
    expect(paymentFn).not.toMatch(/exception\s+when/i)
  })
  it('usa FOR UPDATE com ordem determinística (order by id) — evita deadlock em pagamentos concorrentes',()=>{
    expect(paymentFn).toContain('order by id for update')
  })
  it('dedup de ids duplicados antes de processar',()=>{
    expect(paymentFn).toContain('select array_agg(distinct x) into ids from unnest(p_sale_ids) x;')
  })
  it('array misturando tenant do caller com venda de outro tenant: a venda de fora nunca entra no SELECT, e a contagem resolved≠ids aborta a chamada inteira',()=>{
    expect(paymentFn).toContain('where id=any(ids) and deleted_at is null and organization_id in(select public.current_user_org_ids())')
    expect(paymentFn).toContain("if array_length(resolved_ids,1) is distinct from array_length(ids,1) then raise exception 'sale_not_found'")
  })
  it('audit_logs só é gravado depois do UPDATE ter sido aplicado com sucesso, nunca no ramo "skipped" (idempotente)',()=>{
    const skipBranchEnd=paymentFn.indexOf('continue;')
    const updateIndex=paymentFn.indexOf('update public.sales set')
    const auditIndex=paymentFn.indexOf('insert into public.audit_logs')
    expect(skipBranchEnd).toBeLessThan(updateIndex)
    expect(updateIndex).toBeLessThan(auditIndex)
  })
})

describe('PREFLIGHT item 5 — p_notes nunca sobrescreve sales.notes existente',()=>{
  it('conteúdo anterior é preservado via coalesce, nunca substituído por atribuição direta',()=>{
    expect(paymentFn).toContain("coalesce(notes,'')||case when coalesce(notes,'')<>'' then E'\\n' else '' end||'Pagamento: '||note_suffix")
  })
  it('sem observação, a coluna notes fica exatamente como estava — nunca grava a string "null"',()=>{
    expect(paymentFn).toContain('case when note_suffix is null then notes')
    expect(paymentFn).toContain("note_suffix:=nullif(btrim(coalesce(p_notes,'')),'')")
  })
  it('separador é uma quebra de linha legível, só inserida quando já havia conteúdo anterior',()=>{
    expect(paymentFn).toContain("case when coalesce(notes,'')<>'' then E'\\n' else '' end")
  })
})

describe('PREFLIGHT item 6 — collection_events é append-only na prática, não só por GRANT',()=>{
  it('CHECK constraint restringe event_type ao valor atualmente válido',()=>{
    expect(migration).toContain("event_type text not null check(event_type in('message_copied'))")
  })
  it('trigger dedicado recusa qualquer UPDATE/DELETE na tabela, mesmo se um SECURITY DEFINER futuro ignorar RLS',()=>{
    expect(migration).toContain('create trigger collection_events_append_only before update or delete on public.collection_events')
    expect(migration).toContain("raise exception 'collection_events_is_append_only'")
  })
  it('além do trigger, authenticated continua sem grant de insert/update/delete direto (defesa em profundidade)',()=>{
    expect(migration).toContain('revoke insert,update,delete on public.collection_events from authenticated')
  })
})
