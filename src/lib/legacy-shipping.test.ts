import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countLegacyShipping, formatLegacyShippingInput, legacyShippingLabels, legacyShippingState, parseLegacyShippingInput } from './legacy-shipping'

const foundationMigration=readFileSync(new URL('../../supabase/migrations/202609050002_legacy_shipping_confirmation.sql',import.meta.url),'utf8')
const dateMigration=readFileSync(new URL('../../supabase/migrations/202609050003_legacy_shipping_date_input.sql',import.meta.url),'utf8')
const migration=`${foundationMigration}\n${dateMigration}`
const deliveries=readFileSync(new URL('../pages/DeliveriesPage.tsx',import.meta.url),'utf8')
const clientDetails=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const confirmationSelect=readFileSync(new URL('../components/LegacyShippingConfirmationSelect.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const sql=migration.split('\n').map(line=>line.replace(/--.*$/,'')).join('\n')
const rpc=migration.slice(migration.lastIndexOf('create or replace function public.set_legacy_shipping_confirmation'))

describe('confirmação manual de envio legado',()=>{
  it('mapeia NULL e pending para A CONFIRMAR e conta os três estados',()=>{
    expect(legacyShippingState(null)).toBe('pending')
    expect(legacyShippingState('pending')).toBe('pending')
    expect(legacyShippingLabels.pending).toBe('A CONFIRMAR')
    expect(countLegacyShipping([{legacy_shipping_confirmation:null},{legacy_shipping_confirmation:'pending'},{legacy_shipping_confirmation:'sent'},{legacy_shipping_confirmation:'not_sent'}])).toEqual({pending:2,sent:1,not_sent:1})
  })

  it('interpreta vazio, X e data brasileira estrita',()=>{
    expect(parseLegacyShippingInput('  ')).toEqual({confirmation:'pending',shippingDate:null})
    expect(parseLegacyShippingInput(' x ')).toEqual({confirmation:'not_sent',shippingDate:null})
    expect(parseLegacyShippingInput('14/08/2026')).toEqual({confirmation:'sent',shippingDate:'2026-08-14'})
    for(const invalid of ['enviado','XX','2026-08-14','31/02/2026','1/8/2026'])expect(()=>parseLegacyShippingInput(invalid)).toThrow('DD/MM/AAAA ou X')
    expect(formatLegacyShippingInput('sent','2026-08-14')).toBe('14/08/2026')
    expect(formatLegacyShippingInput('not_sent',null)).toBe('X')
    expect(formatLegacyShippingInput(null,null)).toBe('')
  })

  it('cria campos aditivos sem backfill e mantém pending como NULL',()=>{
    for(const field of ['legacy_shipping_confirmation','legacy_shipping_confirmed_at','legacy_shipping_confirmed_by'])expect(migration).toContain(`add column if not exists ${field}`)
    expect(sql).not.toMatch(/update public\.sales\s+set\s+legacy_shipping_confirmation\s*=\s*'pending'/i)
    expect(rpc).toContain("case when normalized_confirmation = 'pending' then null")
    expect(dateMigration).toContain('add column if not exists legacy_shipping_date date')
    expect(dateMigration).toContain(') not valid;')
  })

  it('protege autenticação, tenant, permissão, venda excluída e concorrência',()=>{
    expect(rpc).toContain('auth.uid() is null')
    expect(rpc).toContain('current_user_org_ids()')
    expect(rpc).toContain("has_org_permission(sale_row.organization_id, 'sales.edit')")
    expect(rpc).toContain('sale_row.deleted_at is not null')
    expect(rpc).toContain('for update')
    expect(rpc).toContain('sale_row.updated_at is distinct from p_expected_updated_at')
    expect(migration).toContain('legacy_shipping_confirmation_requires_rpc')
    expect(rpc).toContain("set_config('app.legacy_shipping_confirmation_rpc', 'allowed', true)")
  })

  it('aceita somente pending/sent/not_sent e bloqueia not_sent com envio real',()=>{
    expect(rpc).toContain("not in ('pending', 'sent', 'not_sent')")
    expect(rpc).toContain("normalized_confirmation = 'not_sent'")
    for(const evidence of ['sale_row.shipped_at is not null',"sh.status in ('posted', 'delivered')",'sh.posted_at is not null','sh.delivered_at is not null',"nullif(btrim(sh.tracking_code), '') is not null"])expect(rpc).toContain(evidence)
    expect(rpc).toContain("raise exception 'operational_shipment_confirmed'")
    expect(rpc).toContain("normalized_confirmation = 'sent' and p_shipping_date is null")
    expect(rpc).toContain("normalized_confirmation in ('pending', 'not_sent') and p_shipping_date is not null")
  })

  it('altera só os três campos manuais e updated_at',()=>{
    const update=rpc.slice(rpc.indexOf('update public.sales set'),rpc.indexOf('returning jsonb_build_object'))
    for(const field of ['legacy_shipping_confirmation =','legacy_shipping_date =','legacy_shipping_confirmed_at =','legacy_shipping_confirmed_by =','updated_at ='])expect(update).toContain(field)
    for(const forbidden of ['payment_status','paid_at','payment_method','amount','deleted_at','shipped_at','tracking_code','perfume_id','client_id'])expect(update).not.toContain(`${forbidden} =`)
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(inventory_items|inventory_allocations|inventory_movements|shipments|shipment_items|preparation_batches|preparation_batch_items)/i)
  })

  it('é idempotente e audita before/after sem dados pessoais',()=>{
    expect(rpc).toContain("'changed', false")
    expect(rpc).toContain("'legacy_shipping_confirmation_changed'")
    for(const field of ["'before'","'after'","'confirmed_by'","'confirmed_at'","'note'","'manual_legacy_shipping_reconciliation'"])expect(rpc).toContain(field)
    for(const pii of ["'client_name'","'email'","'phone'","'cpf'","'address'"])expect(rpc).not.toContain(pii)
  })
})

describe('confirmação manual editável na tela da cliente',()=>{
  it('mantém backend e expõe select individual com as três opções',()=>{
    expect(records).toContain('setLegacyShippingConfirmation')
    expect(clientDetails).toContain('<th>Confirmação manual</th>')
    expect(clientDetails).toContain('<LegacyShippingConfirmationSelect')
    expect(confirmationSelect).toContain("useHasPermission('sales.edit')")
    expect(confirmationSelect).toContain('disabled={!canEdit||saving}')
    expect(confirmationSelect).toContain('<option key={key} value={key}>{legacyShippingLabels[key]}</option>')
    expect(confirmationSelect).toContain('setValue(initial)')
    expect(confirmationSelect).toContain("toast.push")
    expect(deliveries).not.toContain('legacy-delivery-input')
  })
})
