import{describe,expect,it}from'vitest'
import{analyzeCurrentCrm}from'./davi-import-diagnostics-lib.mjs'

const org='org-1'
const client={id:'c1',organization_id:org,name:'Cliente Um',deleted_at:null}
const perfume=(id,name)=>({id,organization_id:org,full_name_raw:name})
const sale=(id,patch={})=>({id,organization_id:org,client_id:'c1',perfume_id:'p1',sale_date:'2026-09-02',sale_type:'SPLIT',volume_ml:4,amount:40,payment_status:'paid',inventory_allocation_eligible:true,deleted_at:null,perfume_name_raw:'Perfume Um',...patch})
const item=(id,perfumeId='p1',available=20)=>({id,organization_id:org,perfume_id:perfumeId,reference_date:'2026-09-01',available_ml:available,status:'active'})
const allocation=(id,saleId,patch={})=>({id,organization_id:org,sale_id:saleId,inventory_item_id:'i1',perfume_id:'p1',quantity_ml:4,original_quantity_ml:4,status:'reserved',allocation_source:'operational_stock',...patch})
const snapshot=(patch={})=>({organization_id:org,tables:{clients:[client],perfumes:[perfume('p1','Perfume Um'),perfume('p2','Perfume Dois')],sales:[],inventory_items:[item('i1')],inventory_allocations:[],shipments:[],shipment_items:[],preparation_batches:[],preparation_batch_items:[],...patch}})
const codes=(report)=>report.findings.map(finding=>finding.code)

describe('analyzeCurrentCrm',()=>{
 it('marca identidade comercial completa como possível duplicidade e evita falso positivo parcial',()=>{
  const report=analyzeCurrentCrm(snapshot({sales:[sale('s1'),sale('s2'),sale('s3',{amount:41})]}))
  expect(report.summary.possible_duplicates).toBe(1)
  expect(report.findings.find(f=>f.code==='POSSIBLE_DUPLICATE')?.related_entities.sale_ids).toEqual(['s1','s2'])
 })

 it('diferencia alias estético de conflito real de perfume',()=>{
  const report=analyzeCurrentCrm(snapshot({
   perfumes:[perfume('p1','Ani — Nishane'),perfume('p2','Outro Perfume')],
   sales:[sale('alias',{perfume_id:'p1',perfume_name_raw:'ANI - NISHANE (FRASCO 1)'}),sale('conflict',{perfume_id:'p2',perfume_name_raw:'ANI - NISHANE'})],
  }))
  expect(codes(report)).toContain('POSSIBLE_ALIAS')
  expect(report.findings.find(f=>f.code==='POSSIBLE_ALIAS')?.severity).toBe('INFO')
  expect(report.findings.find(f=>f.code==='PERFUME_CONFLICT')?.sale_id).toBe('conflict')
 })

 it('classifica venda paga sem alocação e venda sem item físico',()=>{
  const report=analyzeCurrentCrm(snapshot({sales:[sale('with-item'),sale('missing-item',{perfume_id:'p2',perfume_name_raw:'Perfume Dois'})]}))
  expect(codes(report)).toContain('PAID_SALE_WITHOUT_ALLOCATION')
  expect(report.findings.find(f=>f.code==='PAID_ELIGIBLE_SALE_WITHOUT_INVENTORY_ITEM')?.sale_id).toBe('missing-item')
 })

 it('detecta alocação duplicada, quantidade errada e perfume errado',()=>{
  const report=analyzeCurrentCrm(snapshot({sales:[sale('s1')],inventory_allocations:[allocation('a1','s1',{quantity_ml:3}),allocation('a2','s1',{inventory_item_id:'i2',perfume_id:'p2'})],inventory_items:[item('i1'),item('i2','p2')]}))
  expect(codes(report)).toEqual(expect.arrayContaining(['MULTIPLE_ACTIVE_ALLOCATIONS','ALLOCATION_QUANTITY_MISMATCH','ALLOCATION_PERFUME_MISMATCH']))
 })

 it('não transforma venda histórica inelegível ou envio legítimo em erro operacional',()=>{
  const report=analyzeCurrentCrm(snapshot({sales:[sale('historical',{sale_date:'2026-01-01',inventory_allocation_eligible:false}),sale('sent',{shipped_at:'2026-09-03'})]}))
  expect(report.findings.filter(f=>['PAID_SALE_WITHOUT_ALLOCATION','PAID_ELIGIBLE_SALE_WITHOUT_INVENTORY_ITEM'].includes(f.code))).toHaveLength(0)
 })

 it('mantém demanda agregada isolada por item e calcula suficiência e déficit',()=>{
  const sufficient=analyzeCurrentCrm(snapshot({sales:[sale('s1'),sale('s2')],inventory_items:[item('i1','p1',8),item('i2','p2',100)]}))
  expect(sufficient.summary.perfumes_with_projected_deficit).toBe(0)
  expect(sufficient.inventory_by_perfume.find(row=>row.inventory_item_id==='i1')?.projected_balance_ml).toBe(0)
  const insufficient=analyzeCurrentCrm(snapshot({sales:[sale('s1'),sale('s2')],inventory_items:[item('i1','p1',5),item('i2','p2',100)]}))
  expect(insufficient.summary.perfumes_with_projected_deficit).toBe(1)
  expect(insufficient.inventory_by_perfume.find(row=>row.inventory_item_id==='i1')?.deficit_ml).toBe(3)
  expect(insufficient.stock_total).toBeUndefined()
 })

 it('detecta referência quebrada e gera identificadores estáveis',()=>{
  const input=snapshot({sales:[sale('broken',{client_id:'missing'})]})
  const first=analyzeCurrentCrm(input),second=analyzeCurrentCrm(input)
  expect(codes(first)).toContain('BROKEN_CLIENT_REFERENCE')
  expect(first.findings.map(f=>f.id)).toEqual(second.findings.map(f=>f.id))
 })

 it('contabiliza todas as classes de alocação incompatível e valida a referência do envio',()=>{
  const report=analyzeCurrentCrm(snapshot({
   sales:[sale('s1')],
   inventory_allocations:[allocation('a1','s1'),allocation('a2','s1')],
   shipment_items:[{id:'si1',organization_id:org,shipment_id:'missing',allocation_id:'a1',sale_id:'s1',removed_at:null}],
  }))
  expect(report.summary.incompatible_allocations).toBeGreaterThanOrEqual(1)
  expect(codes(report)).toContain('BROKEN_SHIPMENT_REFERENCE')
 })
})
