import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
import{countLegacyShippingStatuses,legacyShippingStatusLabel,parseLegacyShippingStatus}from'./legacy-shipping-status'

const migration=readFileSync(new URL('../../supabase/migrations/202609050004_legacy_shipping_status.sql',import.meta.url),'utf8')
const input=readFileSync(new URL('../components/LegacyShippingStatusInput.tsx',import.meta.url),'utf8')
const deliveries=readFileSync(new URL('../pages/DeliveriesPage.tsx',import.meta.url),'utf8')
const clients=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const sale=readFileSync(new URL('../pages/SaleDetailsPage.tsx',import.meta.url),'utf8')
const sql=migration.split('\n').map(line=>line.replace(/--.*$/,'')).join('\n')
const rpc=migration.slice(migration.indexOf('create or replace function public.set_legacy_shipping_status'))
const schema=migration.slice(0,migration.indexOf('create or replace function public.set_legacy_shipping_status'))

describe('status histórico manual',()=>{
  it('aceita os três rótulos, atalhos e vazio sem classificação',()=>{
    expect(parseLegacyShippingStatus('CONFIRMADO')).toBe('confirmed')
    expect(parseLegacyShippingStatus(' c ')).toBe('confirmed')
    expect(parseLegacyShippingStatus('A ENVIAR')).toBe('to_send')
    expect(parseLegacyShippingStatus('a')).toBe('to_send')
    expect(parseLegacyShippingStatus('SEM ESTOQUE')).toBe('out_of_stock')
    expect(parseLegacyShippingStatus('s')).toBe('out_of_stock')
    expect(parseLegacyShippingStatus('')).toBeNull()
    expect(()=>parseLegacyShippingStatus('enviado')).toThrow()
    expect(legacyShippingStatusLabel(null)).toBe('SEM CLASSIFICAÇÃO')
  })
  it('conta dados reais sem preencher nulos automaticamente',()=>{
    expect(countLegacyShippingStatuses([{legacy_shipping_status:null},{legacy_shipping_status:'confirmed'},{legacy_shipping_status:'to_send'},{legacy_shipping_status:'out_of_stock'}])).toEqual({confirmed:1,to_send:1,out_of_stock:1,unclassified:1})
    expect(schema).not.toMatch(/update public\.sales\s+set\s+legacy_shipping_status/i)
  })
  it('migration cria somente o domínio manual e protege escrita direta',()=>{
    for(const field of ['legacy_shipping_status text','legacy_shipping_status_updated_at timestamptz','legacy_shipping_status_updated_by uuid'])expect(migration).toContain(`add column if not exists ${field}`)
    expect(migration).toContain("legacy_shipping_status in ('confirmed', 'to_send', 'out_of_stock')")
    expect(migration).toContain('legacy_shipping_status_requires_rpc')
    expect(rpc).toContain("set_config('app.legacy_shipping_status_rpc', 'allowed', true)")
  })
  it('RPC preserva autenticação, tenant, sales.edit, lock, concorrência e auditoria',()=>{
    for(const guard of ['auth.uid() is null','current_user_org_ids()',"has_org_permission(sale_row.organization_id, 'sales.edit')",'for update','sale_row.updated_at is distinct from p_expected_updated_at'])expect(rpc).toContain(guard)
    expect(rpc).toContain("'legacy_shipping_status_changed'")
    expect(rpc).toContain("'before', before_state, 'after', after_state")
  })
  it('não escreve em nenhum domínio operacional ou comercial proibido',()=>{
    const update=rpc.slice(rpc.indexOf('update public.sales set'),rpc.indexOf('returning jsonb_build_object'))
    for(const field of ['legacy_shipping_status =','legacy_shipping_status_updated_at =','legacy_shipping_status_updated_by =','updated_at ='])expect(update).toContain(field)
    for(const forbidden of ['amount =','payment_status =','paid_at =','client_id =','perfume_id =','shipped_at =','legacy_shipping_confirmation =','legacy_shipping_date ='])expect(update).not.toContain(forbidden)
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(inventory_items|inventory_allocations|inventory_movements|shipments|shipment_items)/i)
  })
})

describe('input na coluna Status histórico',()=>{
  it('parece input/combobox, sugere três opções e salva seleção, Enter ou blur',()=>{
    expect(input).toContain('<input list={listId}')
    for(const label of ['CONFIRMADO','A ENVIAR','SEM ESTOQUE'])expect(input).toContain(`<option value="${label}"`) 
    expect(input).toContain("event.key==='Enter'")
    expect(input).toContain('onBlur=')
    expect(input).toContain("setFeedback('Salvo')")
  })
  it('usa o mesmo componente nas três telas e sobretudo em Cliente > compras',()=>{
    expect(deliveries).toContain("{key:'status',label:'Status histórico',render:(row)=><LegacyShippingStatusInput")
    expect(clients.match(/<LegacyShippingStatusInput/g)?.length).toBeGreaterThanOrEqual(2)
    expect(clients).toContain('<th>Status histórico</th>')
    expect(sale).toContain("{label:'Status histórico',value:<LegacyShippingStatusInput")
  })
  it('filtros e quatro contadores usam apenas legacy_shipping_status',()=>{
    for(const label of ['TODOS','CONFIRMADO','A ENVIAR','SEM ESTOQUE','SEM CLASSIFICAÇÃO'])expect(deliveries).toContain(label)
    expect(deliveries).toContain("legacyStatusFilter==='all'||row.legacy_shipping_status===legacyStatusFilter")
    expect(deliveries).toContain('countLegacyShippingStatuses(rows)')
  })
  it('mantém o status histórico separado da confirmação manual solicitada',()=>{
    expect(deliveries).not.toContain("label:'Confirmação'")
    expect(clients).toContain('<th>Confirmação manual</th>')
    expect(clients).toContain('<LegacyShippingConfirmationSelect')
    expect(sale).not.toContain("label:'Confirmação manual'")
  })
})
