import { describe, expect, it } from 'vitest'
import { groupSplitItemsByClient, groupSplitItemsByPerfume, splitPrintSummary } from './split-status-print'
import type { SplitStatusItem } from './records'

const item = (overrides: Partial<SplitStatusItem>): SplitStatusItem => ({
  id: 'id', client_id: 'c1', client_name: 'Cliente', client_number: 1, perfume_id: 'p1', perfume_name: 'Perfume',
  sale_type:'SPLIT',payment_status:'paid',brand_house: null, bottle_identifier: null, volume_ml: 5, sale_date: '2026-09-01', split_status: 'not_split',
  split_completed_at: null, split_completed_by: null, updated_at: '2026-09-01T00:00:00Z', ...overrides,
})

describe('agrupamento de splits do dia para impressão', () => {
  it('agrupa por perfume e soma o ml de cada grupo, sem depender de ordem de chegada', () => {
    const items = [
      item({ id: '1', perfume_id: 'p1', perfume_name: 'Naxos', volume_ml: 10, client_id: 'a' }),
      item({ id: '2', perfume_id: 'p2', perfume_name: 'Angelique Noire', volume_ml: 15, client_id: 'b' }),
      item({ id: '3', perfume_id: 'p1', perfume_name: 'Naxos', volume_ml: 5, client_id: 'c' }),
    ]
    const groups = groupSplitItemsByPerfume(items)
    expect(groups).toHaveLength(2)
    const naxos = groups.find((group) => group.perfume_name === 'Naxos')
    expect(naxos?.items).toHaveLength(2)
    expect(naxos?.total_ml).toBe(15)
  })

  it('ordena os grupos alfabeticamente em pt-BR', () => {
    const groups = groupSplitItemsByPerfume([
      item({ id: '1', perfume_id: 'p2', perfume_name: 'Zaad' }),
      item({ id: '2', perfume_id: 'p1', perfume_name: 'Ambre' }),
    ])
    expect(groups.map((group) => group.perfume_name)).toEqual(['Ambre', 'Zaad'])
  })

  it('perfume nulo cai em um grupo próprio, nunca se mistura com outro perfume', () => {
    const groups = groupSplitItemsByPerfume([
      item({ id: '1', perfume_id: null, perfume_name: null }),
      item({ id: '2', perfume_id: 'p1', perfume_name: 'Naxos' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.key === 'SPLIT:—')?.perfume_name).toBe('(sem perfume)')
  })

  it('resumo conta clientes distintos, não linhas — mesma cliente em duas linhas conta uma vez', () => {
    const items = [
      item({ id: '1', client_id: 'a', volume_ml: 5 }),
      item({ id: '2', client_id: 'a', volume_ml: 5 }),
      item({ id: '3', client_id: 'b', volume_ml: 10 }),
    ]
    const groups = groupSplitItemsByPerfume(items)
    const summary = splitPrintSummary(items, groups)
    expect(summary).toMatchObject({ perfumes: 1, splits: 3, clients: 2, ml_total: 20 })
  })

  it('não mistura APC e SPLIT do mesmo perfume na folha de separação',()=>{
    const groups=groupSplitItemsByPerfume([item({id:'1',sale_type:'SPLIT'}),item({id:'2',sale_type:'APC'})])
    expect(groups.map(group=>group.key)).toEqual(['SPLIT:p1','APC:p1'])
  })

  it('agrupa a impressão por pessoa e mantém todos os perfumes da cliente',()=>{
    const groups=groupSplitItemsByClient([
      item({id:'1',client_id:'m',client_name:'Melani Nunes',perfume_id:'p2',perfume_name:'Naxos',volume_ml:5}),
      item({id:'2',client_id:'a',client_name:'Aline Slongo',perfume_id:'p1',perfume_name:'Ambre',volume_ml:3}),
      item({id:'3',client_id:'m',client_name:'Melani Nunes',perfume_id:'p1',perfume_name:'Ambre',volume_ml:8,split_status:'split'}),
    ])
    expect(groups.map(group=>group.client_name)).toEqual(['Aline Slongo','Melani Nunes'])
    expect(groups[1]).toMatchObject({total_ml:13,pending:1,separated:1})
    expect(groups[1].items.map(row=>row.perfume_name)).toEqual(['Ambre','Naxos'])
  })
})
