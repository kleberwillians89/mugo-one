import {expect, test} from 'vitest'
import {analyzeDaviImport,stageDaviParsedRows} from './davi-import-diagnostics-lib.mjs'

const org = 'org-1'
const baseSnapshot = () => ({tables: {
  clients: [{id: 'c1', name: 'Maria Silva', deleted_at: null}, {id: 'c2', name: 'Joana Souza', deleted_at: null}],
  perfumes: [
    {id: 'p1', full_name_raw: 'Perfume A'},
    {id: 'p2', full_name_raw: 'Perfume B'},
    {id: 'p3', full_name_raw: 'Perfume C'},
  ],
  inventory_items: [
    {id: 'i1', organization_id: org, perfume_id: 'p1', available_ml: 50, reference_date: '2026-01-01', status: 'active'},
    {id: 'i2', organization_id: org, perfume_id: 'p2', available_ml: 100, reference_date: '2026-01-01', status: 'active'},
  ],
  sales: [
    {id: 's1', organization_id: org, client_id: 'c1', perfume_id: 'p1', sale_date: '2026-09-01', sale_type: 'SPLIT', volume_ml: 5, amount: 50, payment_status: 'pending', inventory_allocation_eligible: true, deleted_at: null},
    {id: 's2', organization_id: org, client_id: 'c2', perfume_id: 'p2', sale_date: '2026-09-01', sale_type: 'APC', volume_ml: 10, amount: 100, payment_status: 'paid', inventory_allocation_eligible: false, deleted_at: null},
  ],
  inventory_allocations: [
    {id: 'a1', sale_id: 's1', inventory_item_id: 'i1', perfume_id: 'p1', quantity_ml: 5, status: 'reserved'},
  ],
}})

const row = (overrides = {}) => ({
  source_row: 10, display_client: 'Maria Silva', client: 'maria silva', resolved_client_id: 'c1',
  display_perfume: 'Perfume A', perfume: 'perfume a', resolved_perfume_id: 'p1',
  date: '2026-09-02', type: 'split', ml: 30, amount: 300, payment_status: 'paid',
  classification: 'new_safe', match_candidate: null, confidence: 0.95, reason: 'Sem correspondência.', proposed_changes: {},
  ...overrides,
})

test('classifica identidade exata, duplicidade provável, conflito e inválida sem fuzzy automático', () => {
  const staging = {organization_id: org, rows: [
    row({source_row: 1, classification: 'existing_changed', match_candidate: 's1', proposed_changes: {payment_status: {before: 'pending', after: 'paid'}}, ml: 8, amount: 50, date: '2026-09-01'}),
    row({source_row: 2, classification: 'possible_duplicate', ml: 5, amount: 50, date: '2026-09-01'}),
    row({source_row: 3, classification: 'possible_duplicate', ml: 7, amount: 50, date: '2026-09-01'}),
    row({source_row: 4, classification: 'review_required', amount: null}),
  ]}
  const report = analyzeDaviImport({staging, snapshot: baseSnapshot()})
  expect(report.rows.map((item) => item.identity_classification)).toEqual(['EXACT_EXISTING', 'PROBABLE_DUPLICATE', 'CONFLICT', 'INVALID'])
  expect(report.rows[1].sale_id).toBe('s1')
  expect(report.rows[2].reason).toMatch(/ml/)
  expect(report.identity.updates_with_changes).toBe(1)
})

test('simula demanda agregada por perfume e não compensa déficit com outro perfume', () => {
  const staging = {organization_id: org, rows: [
    row({source_row: 1, classification: 'existing_changed', match_candidate: 's1', proposed_changes: {payment_status: {before: 'pending', after: 'paid'}}, ml: 8, amount: 50, date: '2026-09-01'}),
    row({source_row: 10, ml: 30}),
    row({source_row: 11, ml: 30, amount: 301}),
    row({source_row: 12, resolved_perfume_id: 'p2', perfume: 'perfume b', display_perfume: 'Perfume B', ml: 30}),
  ]}
  const report = analyzeDaviImport({staging, snapshot: baseSnapshot()})
  expect(report.rows[0].allocation_need.needed_ml, 'uma alocação existente de 5 ml exige apenas delta até 8 ml').toBe(3)
  expect(report.rows.map((item) => item.stock_classification)).toEqual(['STOCK_OK', 'STOCK_OK', 'STOCK_INSUFFICIENT', 'STOCK_OK'])
  const perfumeA = report.inventory_by_perfume.find((item) => item.perfume_id === 'p1')
  const perfumeB = report.inventory_by_perfume.find((item) => item.perfume_id === 'p2')
  expect(perfumeA.already_reserved_ml).toBe(5)
  expect(perfumeA.new_demand_ml).toBe(63)
  expect(perfumeA.deficit_ml).toBe(13)
  expect(perfumeB.new_demand_ml).toBe(30)
  expect(perfumeB.surplus_ml).toBe(70)
  expect(report.stock.total_deficit_ml, 'a sobra do perfume B não compensa o déficit do perfume A').toBe(13)
})

test('distingue item ausente, venda histórica e linha em revisão', () => {
  const staging = {organization_id: org, rows: [
    row({source_row: 1, resolved_perfume_id: 'p3', perfume: 'perfume c', display_perfume: 'Perfume C', ml: 7}),
    row({source_row: 2, classification: 'existing_changed', match_candidate: 's2', resolved_client_id: 'c2', client: 'joana souza', display_client: 'Joana Souza', resolved_perfume_id: 'p2', perfume: 'perfume b', display_perfume: 'Perfume B', type: 'apc', ml: 10, amount: 100, date: '2026-09-01', proposed_changes: {payment_method: {before: null, after: 'pix'}}}),
    row({source_row: 3, classification: 'review_required'}),
  ]}
  const report = analyzeDaviImport({staging, snapshot: baseSnapshot()})
  expect(report.rows[0].stock_classification).toBe('STOCK_ITEM_MISSING')
  expect(report.rows[1].stock_classification).toBe('STOCK_NOT_REQUIRED')
  expect(report.rows[2].stock_classification).toBeNull()
  expect(report.stock.stock_item_missing.ml).toBe(7)
  expect(report.stock.excluded_for_manual_review).toBe(1)
})

test('não altera snapshot nem staging recebidos', () => {
  const snapshot = baseSnapshot()
  const staging = {organization_id: org, rows: [row()]}
  const beforeSnapshot = structuredClone(snapshot), beforeStaging = structuredClone(staging)
  analyzeDaviImport({staging, snapshot})
  expect(snapshot).toEqual(beforeSnapshot)
  expect(staging).toEqual(beforeStaging)
})

test('staging compartilhado preserva data da fonte e correspondência multiconjunto', () => {
  const snapshot=baseSnapshot()
  snapshot.tables.sales.push({...snapshot.tables.sales[0],id:'s3',payment_status:'paid'})
  const parsed=[
    {row:2,client:'Maria Silva',date:'2026-01-09',amount:50,paymentStatus:'paid',paymentMethod:'',raw:{CLIENTE:'Maria Silva',DATA:'9/1/2026',PERFUME:'Perfume A',TIPO:'SPLIT',ML:'5',VALOR:'50',PAGAMENTO:'PAGO'}},
    {row:3,client:'Maria Silva',date:'2026-01-09',amount:50,paymentStatus:'pending',paymentMethod:'',raw:{CLIENTE:'Maria Silva',DATA:'9/1/2026',PERFUME:'Perfume A',TIPO:'SPLIT',ML:'5',VALOR:'50',PAGAMENTO:'PENDENTE'}},
  ]
  snapshot.tables.sales[0].sale_date='2026-09-01';snapshot.tables.sales[1].sale_date='2026-09-01';snapshot.tables.sales[2].sale_date='2026-09-01'
  const staged=stageDaviParsedRows(parsed,snapshot)
  expect(staged.rows.map(item=>item.date)).toEqual(['2026-09-01','2026-09-01'])
  expect(staged.rows.map(item=>item.match_candidate)).toEqual(['s3','s1'])
  expect(staged.rows.map(item=>item.classification)).toEqual(['existing_exact','existing_exact'])
})
