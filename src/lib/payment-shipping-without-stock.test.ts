import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const sql=readFileSync('supabase/migrations/202609140001_paid_sale_shipping_without_available_ml.sql','utf8')

describe('pagamento libera cálculo de frete mesmo sem ML disponível',()=>{
  it('mantém o saldo líquido das vendas e cria alocação logística sem nova baixa',()=>{
    expect(sql).toContain("'sale_validated_shipping'")
    expect(sql).toContain("'reserved',now(),'sale_validated_shipping',false")
    expect(sql).toContain('v_item.available_ml>=new.volume_ml')
    expect(sql).toContain("'sale_shipping_released_without_available_ml'")
  })
  it('a alocação sem estoque continua apta ao fluxo de frete',()=>{
    expect(sql).toContain("allocation_source in('legacy_manual_verified','sale_validated_shipping')")
    expect(sql).toContain('inventory_item_id is null')
    expect(sql).toContain('quantity_ml=new.volume_ml')
  })
  it('não altera o saldo quando usa a alternativa logística',()=>{
    const fallback=sql.slice(sql.indexOf("else\n    insert into public.inventory_allocations"),sql.indexOf("return new;\nend;$$"))
    expect(fallback).not.toMatch(/update public\.inventory_items/)
    expect(fallback).not.toContain('insufficient_available_inventory')
  })
})
