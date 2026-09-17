import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const davi=readFileSync('src/legacy/spreadsheet/DaviExcelPage.tsx','utf8')
const drafts=readFileSync('src/legacy/spreadsheet/DaviExcelNewRows.tsx','utf8')
const print=readFileSync('src/pages/ShipmentPrintPage.tsx','utf8')
const migration=readFileSync('supabase/migrations/202608230004_operational_consistency.sql','utf8')

describe('consistência operacional P0',()=>{
 it('apresenta pagamentos em PT-BR sem alterar os enums persistidos',()=>{
  for(const label of ['PAGO','AGUARDANDO','CANCELADO','DESCONHECIDO'])expect(davi+drafts).toContain(label)
  expect(davi).toContain("{['paid','pending','cancelled','unknown'].map(value=><option value={value} key={value}>{paymentLabel[value]}</option>)}")
  expect(drafts).toContain('<option value="unknown">DESCONHECIDO</option>')
  expect(davi).toContain("'PAGAMENTO':valueLabel('payment',row.payment_status)")
 })

 it('nota deriva o destino apenas do snapshot do shipment',()=>{
  for(const field of ['recipient_name','recipient_phone','recipient_address','recipient_number','recipient_complement','recipient_district','recipient_city','recipient_state','recipient_postal_code'])expect(print).toContain(`shipment.${field}`)
  expect(print).not.toContain('clients?.address')
  expect(print).not.toContain('shipment.clients?.name')
  expect(print).not.toContain('Julia Lins Portela')
  expect(print).toContain('shipment-document-logistics')
 })

 it('shipment ativo prevalece no Davi e custódia externa não vira baixa física',()=>{
  expect(migration).toContain('shipment_items si')
  expect(migration).toContain("active_shipment.shipment_id is not null then 'ENVIO EM ANDAMENTO'")
  expect(migration).toContain("allocation_source='legacy_manual_verified'")
  expect(migration).toContain('not a.stock_managed')
  expect(migration).not.toContain('update public.inventory_items')
 })
})
