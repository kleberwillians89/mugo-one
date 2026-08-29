import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'
import{clientNumber}from'./format'

const m1=readFileSync('supabase/migrations/202608280001_client_number_split_completed_at.sql','utf8')
const m2=readFileSync('supabase/migrations/202608280002_client_gift.sql','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const davi=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const drafts=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const clients=readFileSync('src/pages/ClientsPage.tsx','utf8')
const details=readFileSync('src/pages/ClientDetailsPage.tsx','utf8')

describe('client_number permanente e tenant-safe',()=>{
 it('é inteiro positivo e único por organização',()=>{
  expect(m1).toContain('client_number integer')
  expect(m1).toContain('add constraint clients_client_number_positive check (client_number > 0)')
  expect(m1).toContain('add constraint clients_organization_client_number_key unique (organization_id, client_number)')
  expect(m1).not.toContain('unique (client_number)')
 })
 it('backfill determinístico por created_at, id — nunca por índice de tela',()=>{
  expect(m1).toContain('row_number() over (partition by organization_id order by created_at, id)')
 })
 it('contador por organização com incremento atômico e sem reuso',()=>{
  expect(m1).toContain('create table public.client_number_counters')
  expect(m1).toContain('on conflict (organization_id) do update')
  expect(m1).toContain('last_number = public.client_number_counters.last_number + 1')
  expect(m1).toContain('returning last_number into new.client_number')
 })
 it('cliente existente nunca troca de número',()=>{
  expect(m1).toContain("raise exception 'client_number_is_permanent'")
  expect(m1).toContain("raise exception 'client_organization_is_permanent'")
 })
 it('a atribuição não observa vendas',()=>{
  const fn=m1.slice(m1.indexOf('function public.assign_permanent_client_number'),m1.indexOf('-- 2. DATA DO SPLIT'))
  expect(fn).not.toMatch(/public\.sales|sale_date|payment_status/)
 })
 it('formata só na apresentação e permite busca pelo número',()=>{
  expect(clientNumber(1)).toBe('001')
  expect(clientNumber(25)).toBe('025')
  expect(clientNumber(471)).toBe('471')
  expect(clientNumber(1000)).toBe('1000')
  expect(clientNumber(null)).toBe('—')
  expect(clients).toContain("String(client.client_number??'').includes(normalizedSearch)")
  expect(clients).not.toMatch(/index\s*\+\s*1/)
  expect(details).toContain('CLIENTE Nº {clientNumber(client.client_number)}')
  expect(details).not.toContain('Nº DO CLIENTE')
 })
})

describe('split_completed_at independente e auditável',()=>{
 const updater=m1.slice(m1.indexOf('function public.davi_excel_update_sale'),m1.indexOf('3.3 Read model'))
 it('DATE nullable, só para SPLIT, com índice',()=>{
  expect(m1).toContain('add column if not exists split_completed_at date')
  expect(m1).toContain("check (split_completed_at is null or sale_type = 'SPLIT')")
  expect(m1).toContain('sales_org_split_completed_at_idx')
 })
 it('SPLIT aceita data ou null; APC rejeita data',()=>{
  expect(m1).toContain("raise exception 'split_date_requires_split_sale'")
  expect(davi).toContain("disabled={draft.sale_type!=='SPLIT'}")
  expect(davi).toContain("split_completed_at:e.target.value==='APC'?'':draft.split_completed_at")
  expect(drafts).toContain("row.type!=='SPLIT'")
 })
 it('edita a mesma venda com concorrência, tenant e audit before/after',()=>{
  expect(updater).toContain('where id=p_sale_id and organization_id in(select public.current_user_org_ids())')
  expect(updater).toContain('before_row.updated_at is distinct from p_expected_updated_at')
  expect(updater).toContain("'split_completed_at'")
  expect(updater).toContain("'before',to_jsonb(before_row)")
  expect(updater).toContain("'after',to_jsonb(after_row)")
 })
 it('salvar a data não cria estoque, preparação, shipment nem baixa ML',()=>{
  expect(updater).not.toMatch(/insert into public\.(inventory|preparation|shipment)/)
  expect(updater).not.toMatch(/update public\.(inventory|preparation|shipment)/)
  expect(updater).not.toContain('post_shipment')
 })
 it('ordena e filtra SPLITADO/NÃO SPLITADO ignorando APC',()=>{
  expect(m1).toContain("when 'split_completed_at' then 'split_completed_at'")
  expect(m1).toContain("d.sale_type='SPLIT' and d.split_completed_at is not null")
  expect(m1).toContain("d.sale_type='SPLIT' and d.split_completed_at is null")
  expect(davi).toContain('<option value="completed">SPLITADO</option>')
  expect(davi).toContain('<option value="pending">NÃO SPLITADO</option>')
 })
 it('recarrega, exibe e exporta a data entre PERFUME e VALOR',()=>{
  expect(records).toContain('volume_ml,split_completed_at,amount')
  expect(davi.indexOf("key:'perfume'")).toBeLessThan(davi.indexOf("key:'split_completed_at'"))
  expect(davi.indexOf("key:'split_completed_at'")).toBeLessThan(davi.indexOf("key:'amount'"))
  expect(davi).toContain("'DATA DO SPLIT':date(row.split_completed_at)")
 })
 it('importador aceita 13 e 14 colunas sem deslocar VALOR',()=>{
  expect(drafts).toContain('hasSplit=values.length===12||values.length===14')
 })
})

describe('cliente com brinde — flag única do cliente',()=>{
 const fn=m2.slice(m2.indexOf('function public.davi_excel_set_client_gift'))
 it('has_gift boolean not null default false; gift_notes exige brinde',()=>{
  expect(m2).toContain('add column if not exists has_gift boolean not null default false')
  expect(m2).toContain('add column if not exists gift_notes text')
  expect(m2).toContain('check (gift_notes is null or has_gift = true)')
 })
 it('brinde não é replicado em public.sales',()=>{
  expect(m2).not.toMatch(/alter table public\.sales[^;]*gift/i)
  expect(m2).toContain('não replicada em public.sales')
 })
 it('toggle valida tenant, permissão clients.edit, concorrência e audit before/after',()=>{
  expect(fn).toContain('organization_id in (select public.current_user_org_ids())')
  expect(fn).toContain("has_org_permission(before_row.organization_id,'clients.edit')")
  expect(fn).toContain('before_row.updated_at is distinct from p_expected_updated_at')
  expect(fn).toContain("'client_gift_updated'")
  expect(fn).toContain("'before',jsonb_build_object('has_gift',before_row.has_gift")
  expect(fn).toContain("'after',jsonb_build_object('has_gift',after_row.has_gift")
 })
 it('marcar/desmarcar nunca cria venda nem toca estoque; desmarcar limpa a observação',()=>{
  expect(fn).not.toMatch(/insert into public\.sales/i)
  expect(fn).not.toMatch(/insert into public\.(inventory|preparation|shipment)/i)
  expect(fn).not.toMatch(/update public\.(inventory|preparation|shipment)/i)
  expect(fn).toContain("'sale_created',false")
  expect(fn).toContain("case when next_gift then nullif(btrim(p_gift_notes),'') else null end")
 })
 it('somente authenticated executa o RPC',()=>{
  expect(m2).toContain('revoke all on function public.davi_excel_set_client_gift(uuid,boolean,text,timestamptz) from public,anon')
  expect(m2).toContain('grant execute on function public.davi_excel_set_client_gift(uuid,boolean,text,timestamptz) to authenticated')
 })
 it('Davi Excel mostra BRINDE após CLIENTE e filtra COM/SEM BRINDE',()=>{
  expect(davi).toContain("hasGift?'SIM · COM BRINDE':'—'")
  expect(davi).toContain('<option value="with">COM BRINDE</option>')
  expect(davi).toContain('<option value="without">SEM BRINDE</option>')
  expect(davi).toContain('<th key="__gift">BRINDE</th>')
  expect(m2).toContain("($1->>'gift'='with' and d.has_gift)")
 })
 it('records expõe o tipo e a chamada canônica do RPC',()=>{
  expect(records).toContain("rpc('davi_excel_set_client_gift'")
  expect(records).toContain('has_gift:boolean;gift_notes:string|null')
 })
 it('ClientDetailsPage mostra e edita o brinde sob clients.edit',()=>{
  expect(details).toContain("useHasPermission('clients.edit')")
  expect(details).toContain('ClientGiftCard')
  expect(details).toContain("{label:'Observação do brinde',value:giftNotes}")
 })
})
