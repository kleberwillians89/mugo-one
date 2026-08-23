import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202608220005_davi_excel_shipping_snapshot.sql','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const routing=readFileSync('src/routing.ts','utf8')

describe('Davi Excel canônico',()=>{
 it('expõe a rota ao preset comercial pela permissão já existente',()=>{expect(routing).toContain("'Davi Excel':'/davi-excel'");expect(routing).toContain("'Davi Excel':['sales.view']")})
 it('preserva a ordem exata das treze colunas',()=>expect(page).toContain("['CLIENTE','DATA','PRAZO DE ENVIO','DATA DE ENVIO','TIPO','ML','PERFUME','VALOR','PAGAMENTO','FORMA DE PAGAMENTO','DATA PAGMT','CRÉDITO','OBSERVAÇÃO']"))
 it('lê vendas, clientes, perfumes, preparação e snapshot numa única RPC paginada',()=>{for(const source of ['public.sales','public.clients','public.perfumes','public.preparation_batch_items','public.customer_shipment_request_items'])expect(migration).toContain(source);expect(migration).toContain('limit least(greatest(p_page_size,1),500)');expect(migration).toContain('offset greatest(p_page,0)')})
 it('aplica busca, filtros e ordenação no servidor',()=>{for(const field of ['search','client','perfume','type','payment','method','operational_status','sale_from','sale_to','shipped_from','shipped_to','credit'])expect(migration).toContain(`p_filters->>'${field}'`);for(const sort of ['client_asc','sale_date_desc','shipped_at_desc','perfume_asc','amount_desc','paid_at_desc'])expect(migration).toContain(`p_sort='${sort}'`)})
 it('data de envio usa postagem real, nunca criação, cotação ou etiqueta',()=>{expect(migration).toContain('coalesce(ship.posted_at,s.shipped_at) shipped_at');expect(migration).not.toMatch(/shipping_price[^\n]*shipped_at|selected_quote[^\n]*shipped_at|label_released[^\n]*shipped_at/)})
 it('crédito e logística não são editáveis',()=>{expect(migration).toContain("array['sale_date','sale_type','amount','payment_status','payment_method','paid_at','notes']");expect(migration).not.toContain("array['credit_reference_amount'");expect(page).not.toContain('field="credit_reference_amount"');expect(page).not.toContain('field="shipped_at"')})
 it('edição exige sales.edit, reverte erro e exporta sem UUID',()=>{expect(migration).toContain("has_org_permission(s.organization_id,'sales.edit')");expect(page).toContain('setValue(previous)');expect(page).toContain("exportCsv('davi-excel.csv'");expect(page).not.toContain("'UUID'")})
 it('abre o Venda 360 canônico',()=>expect(page).toContain('`/vendas/${row.id}`'))
})

describe('snapshot congelado do Minha RUAH',()=>{
 it('persiste request/allocation/perfume/quantity no snapshot existente',()=>expect(migration).toContain('insert into public.customer_shipment_request_items(request_id,allocation_id,perfume_id,quantity_ml)'))
 it('serializa solicitações concorrentes por cliente',()=>expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(client::text,220005))'))
 it('bloqueia segundo envio ativo usando apenas estados reais',()=>{expect(migration).toContain("raise exception 'active_shipment_exists'");expect(migration).toContain("sh.status not in('posted','delivered','cancelled')")})
 it('é idempotente no retry do mesmo snapshot exato',()=>{expect(migration).toContain('if existing_snapshot=requested_snapshot then return active_request');expect(migration).toContain("raise exception 'duplicate_allocation'");expect(migration).toContain("'quantity_ml',quantity_ml")})
 it('novas compras não reconstroem ou alteram snapshot/cotação/aprovação',()=>{const fn=migration.slice(0,migration.indexOf('-- Leitura única'));expect(fn).not.toMatch(/update public\.shipment_items|update public\.shipment_quotes|shipping_price=|customer_approved_at=|selected_quote_id=/)})
 it('não toca físico, postagem, preparação ou SuperFrete',()=>{expect(migration).not.toMatch(/physical_ml\s*=|post_shipment\s*\(|superfrete_order_id\s*=|insert into public\.preparation_batches/)})
 it('portal distingue envio atual e próximo envio sem jargão técnico',()=>{expect(portal).toContain('ENVIO EM ANDAMENTO');expect(portal).toContain('DISPONÍVEL PARA O PRÓXIMO ENVIO');expect(portal).toContain('Você já possui um envio em andamento.');expect(portal).not.toContain('SOLICITAR OUTRO ENVIO')})
})
