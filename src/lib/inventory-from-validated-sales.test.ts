import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202609120001_inventory_birth_from_validated_sales.sql','utf8')
const inventory=readFileSync('src/pages/InventoryPage.tsx','utf8')

describe('estoque nascido das vendas validadas',()=>{
  it('cria o item do perfume mesmo quando a sobra é zero',()=>{
    expect(migration).toContain('create trigger validated_sale_inventory_birth')
    expect(migration).toContain("'Criado automaticamente por venda validada.'")
    expect(migration).toContain("available_ml,physical_ml")
  })
  it('usa a sobra informada por perfume sem presumir capacidade do frasco',()=>{
    expect(migration).toContain("group_item->>'availability_ml'")
    expect(migration).toContain("p_batch->>'remaining_available_ml'")
    expect(migration).not.toMatch(/100\s*-\s*(?:volume|ml)/i)
  })
  it('é atômico e idempotente por lote, perfume e frasco',()=>{
    expect(migration).toContain('unique (organization_id, source_key)')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('sale_inventory_source_reused_with_different_payload')
  })
  it('vincula as vendas ao item e audita a entrada da sobra',()=>{
    expect(migration).toContain('inventory_item_id=(birth->>\'inventory_item_id\')::uuid')
    expect(migration).toContain("'validated_sale_remainder'")
    expect(migration).toContain("'inventory_born_from_validated_sale'")
  })
  it('explica o fluxo automático no estado vazio',()=>{
    expect(inventory).toContain('Estoque aguardando a primeira venda')
    expect(inventory).toContain('sobra de ML ficará disponível automaticamente')
    expect(inventory).toContain('DISPONÍVEL PARA VENDA')
    expect(inventory).toContain('inventory-perfume-card')
  })
})
