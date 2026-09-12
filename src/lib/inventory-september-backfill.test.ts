import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const sql=readFileSync('supabase/migrations/202609120002_backfill_inventory_from_september_sales.sql','utf8')

describe('backfill do estoque desde 04/09',()=>{
  it('cria item para todo perfume de venda válida no recorte',()=>{
    expect(sql).toContain("s.sale_date>=date '2026-09-04'")
    expect(sql).toContain("s.data_quality_status='verified'")
    expect(sql).toContain("s.payment_status not in('unknown','cancelled')")
    expect(sql).toContain('on conflict(organization_id,perfume_id) do nothing')
  })
  it('vincula retroativamente as vendas ao item canônico',()=>{
    expect(sql).toContain('update public.sales s set inventory_item_id=i.id')
    expect(sql).toContain('s.inventory_item_id is distinct from i.id')
  })
  it('calcula sobra pela capacidade original menos o total vendido',()=>{
    expect(sql).toContain('Frasco original')
    expect(sql).toContain('- b.total_ml')
    expect(sql).toContain('greatest(0,')
  })
  it('considera somente lote que assina uma venda ativa e não duplica o crédito',()=>{
    expect(sql).toContain("s.import_signature=public.ai_sha256_hex(b.fingerprint||'|0')")
    expect(sql).toContain("v_source_key:='backfill-2026-09-04|'")
    expect(sql).toContain('public.sale_inventory_births')
  })
  it('registra movimento e auditoria do saldo positivo',()=>{
    expect(sql).toContain("'validated_sale_backfill'")
    expect(sql).toContain("'inventory_backfilled_from_validated_sales'")
  })
})
