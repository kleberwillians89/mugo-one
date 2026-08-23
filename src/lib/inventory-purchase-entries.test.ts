import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql=readFileSync('supabase/migrations/202608230012_inventory_purchase_entries.sql','utf8').toLowerCase()

describe('histórico canônico de compras físicas',()=>{
  it('cria uma purchase entry vinculada a perfume, item e movimento',()=>{
    for(const field of ['perfume_id uuid not null','inventory_item_id uuid not null','inventory_movement_id uuid not null'])expect(sql).toContain(field)
    expect(sql).toContain('create table public.inventory_purchase_entries')
  })
  it('rejeita quantidade de unidades não positiva',()=>expect(sql).toContain('check(quantity_units>0)'))
  it('rejeita volume do frasco não positivo',()=>expect(sql).toContain('check(bottle_volume_ml>0)'))
  it('rejeita total divergente de quantidade vezes volume',()=>expect(sql).toContain('check(total_volume_ml=quantity_units*bottle_volume_ml)'))
  it('é idempotente por organização, hash e source row',()=>expect(sql).toContain('unique(organization_id,source_hash,source_row)'))
  it('um movimento não aceita duas compras',()=>expect(sql).toContain('unique(inventory_movement_id)'))
  it('pending aceita custos nulos sem contaminar a média',()=>{
    expect(sql).toContain("cost_status in('known','pending','zero_review')")
    expect(sql).toContain("filter(where e.cost_status='known' and e.total_cost_brl is not null)")
  })
  it('zero_review aceita custo zero e fica fora do custo conhecido',()=>{
    expect(sql).toContain("cost_status<>'known' or")
    expect(sql).toContain("count(*) filter(where e.cost_status='zero_review')")
  })
  it.each(['eur','gbp'])('aceita moeda %s e exige câmbio positivo para moeda estrangeira',(currency)=>{
    expect(sql).toContain(`'${currency}'`)
    expect(sql).toContain("currency='brl' or (exchange_rate_brl is not null and exchange_rate_brl>0)")
  })
  it('isola leitura e escrita por tenant e permissões canônicas',()=>{
    expect(sql.match(/organization_id in\(select public\.current_user_org_ids\(\)\)/g)?.length).toBeGreaterThanOrEqual(5)
    expect(sql).toContain("has_org_permission(organization_id,'cost_margin.view')")
    expect(sql).toContain("has_org_permission(organization_id,'inventory.adjust')")
    expect(sql).toContain("has_org_permission(organization_id,'cost_margin.edit')")
  })
  it('impede vínculos cruzados entre organizações e objetos operacionais',()=>{
    for(const error of ['purchase_inventory_item_scope_mismatch','purchase_perfume_scope_mismatch','purchase_movement_scope_mismatch'])expect(sql).toContain(error)
    expect(sql).toContain('movement.quantity_ml<>new.total_volume_ml')
  })
  it('calcula custo médio ponderado por ml e por frasco somente do histórico conhecido',()=>{
    expect(sql).toContain('create function public.inventory_purchase_cost_summary')
    expect(sql).toContain('/ nullif(sum(e.total_volume_ml) filter')
    expect(sql).toContain('/ nullif(sum(e.quantity_units) filter')
  })
  it('preserva múltiplas compras do mesmo perfume em movimentos diferentes',()=>{
    expect(sql).not.toContain('unique(perfume_id)')
    expect(sql).toContain('unique(inventory_movement_id)')
    expect(sql).toContain('inventory_purchase_entries_org_perfume_idx')
  })
  it('não usa average_cost_per_ml como fonte histórica nem cria estoque',()=>{
    expect(sql).not.toContain('update public.perfumes')
    expect(sql).not.toContain('insert into public.inventory_items')
    expect(sql).not.toContain('insert into public.inventory_movements')
    expect(sql).not.toContain('operational_code')
  })
})
