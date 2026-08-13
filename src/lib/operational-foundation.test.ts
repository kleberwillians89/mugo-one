import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
import { analyzeIncrementalRows,classifyIncrementalSale,incrementalSaleSignature,parseRows } from './importer'
import { normalizeBrazilianPhone,normalizeCpf,normalizePostalCode,normalizeState } from './normalization'

const migration=readFileSync(new URL('../../supabase/migrations/202608130001_operational_foundation.sql',import.meta.url),'utf8')
const custodyMigration=readFileSync(new URL('../../supabase/migrations/202608130008_legacy_custody_bridge.sql',import.meta.url),'utf8')
const recordsSource=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('caracterização e fundação operacional',()=>{
  it('documenta que o trigger histórico também atingia pending',()=>{
    const legacy=readFileSync(new URL('../../supabase/migrations/202607300016_inventory_trigger_signature.sql',import.meta.url),'utf8')
    expect(legacy).toContain("new.payment_status<>'cancelled'")
  })
  it('novo trigger reserva exclusivamente vendas pagas',()=>{
    expect(migration).toContain("new.payment_status<>'paid'")
    expect(migration).toContain('not new.inventory_allocation_eligible')
    expect(migration).toContain("insert into public.inventory_allocations")
    expect(migration).toContain("status='released'")
    expect(migration).toContain("for update")
    expect(migration).not.toContain("new.payment_status<>'cancelled'")
  })
  it('shipment preserva snapshot e agrupa alocações',()=>{
    expect(migration).toContain('recipient_name text not null')
    expect(migration).toContain('p_allocation_ids uuid[]')
    expect(migration).toContain("set status='shipping'")
    expect(migration).toContain("set status='reserved',shipment_id=null")
  })
  it('não converte histórico pago em reserva e torna postagem idempotente',()=>{
    expect(migration).toContain("inventory_allocation_eligible boolean not null default false")
    expect(migration).toContain("update public.inventory_items set physical_ml=available_ml,reconciliation_status='review_required'")
    expect(migration).toContain("if v.status in('posted','delivered') then return")
    expect(migration).not.toContain("where s.deleted_at is null and s.payment_status='paid'")
  })
  it('normaliza contatos brasileiros sem rejeitar formatos incompletos',()=>{
    expect(normalizeBrazilianPhone('(11) 99999-1234')).toBe('5511999991234')
    expect(normalizeCpf('123.456.789-00')).toBe('12345678900')
    expect(normalizePostalCode('01310-100')).toBe('01310100')
    expect(normalizeState(' sp ')).toBe('SP')
  })
  it('assinatura incremental independe do nome do arquivo',()=>{
    const matrix=[['CLIENTE','DATA','PERFUME','TIPO','ML','VALOR','PAGAMENTO','FORMA DE PAGAMENTO'],['ANA',new Date('2026-07-01'),'A','SPLIT',5,100,'PAGO','PIX']]
    const a=parseRows('julho.xlsx',['PERFUMES'],'PERFUMES',matrix)
    const b=parseRows('agosto.xlsx',['PERFUMES'],'PERFUMES',matrix)
    expect(a.rows[0].signature).toBe(b.rows[0].signature)
    const existing=incrementalSaleSignature({client:'ANA',date:'2026-07-01',perfume:'A',type:'SPLIT',ml:5,amount:100,paymentStatus:'PAGO',paymentMethod:'PIX'})
    expect(analyzeIncrementalRows(b.rows,[existing]).existingRows).toBe(1)
  })
  it('classifica idêntica, mudança de pagamento, nova e ambígua',()=>{
    const base={client:'MARIA',date:'2026-07-05',perfume:'IMAGINATION',type:'SPLIT',ml:10,amount:350,paymentStatus:'pending',paymentMethod:'PIX'}
    expect(classifyIncrementalSale(base,[base])).toBe('existing_exact')
    expect(classifyIncrementalSale({...base,paymentStatus:'paid',paidAt:'2026-07-10'},[base])).toBe('existing_changed')
    expect(classifyIncrementalSale({...base,date:'2026-08-01'},[base])).toBe('new_safe')
    expect(classifyIncrementalSale({...base,perfume:'OUTRO'},[base])).toBe('possible_duplicate')
  })
  it('segunda classificação de venda aplicada não cria nova venda',()=>{
    const sale={client:'ANA',date:'2026-08-01',perfume:'A',type:'SPLIT',ml:5,amount:100,paymentStatus:'paid'}
    expect(classifyIncrementalSale(sale,[])).toBe('new_safe')
    expect(classifyIncrementalSale(sale,[sale])).toBe('existing_exact')
  })
  it('Venda 360 usa somente colunas canônicas do estoque',()=>{
    expect(recordsSource).not.toContain('current_ml')
    expect(recordsSource).toContain('physical_ml,available_ml')
  })
  it('custódia histórica é manual, auditada e não movimenta estoque físico',()=>{
    expect(custodyMigration).toContain("'legacy_manual_verified',false")
    expect(custodyMigration).toContain("'legacy_custody_confirmed'")
    expect(custodyMigration).toContain('if r.stock_managed then')
    expect(custodyMigration).toContain("status='released'")
    expect(custodyMigration).not.toContain("allocation_source='legacy_manual_verified' then\n      update public.inventory_items")
  })
})
