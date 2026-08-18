import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../supabase/migrations/202608170001_radar_global_foundation.sql', import.meta.url), 'utf8')
const inventoryPage = readFileSync(new URL('../pages/InventoryPage.tsx', import.meta.url), 'utf8')

describe('migration do Radar Global não toca tabelas operacionais existentes', () => {
  it('não altera inventory_allocations, shipments, sales, inventory_items ou perfumes', () => {
    const forbidden = [
      /alter table public\.inventory_allocations/i,
      /alter table public\.shipments/i,
      /alter table public\.shipment_items/i,
      /alter table public\.sales/i,
      /alter table public\.inventory_items/i,
      /alter table public\.perfumes/i,
      /alter table public\.clients/i,
      /alter table public\.import_batches/i,
    ]
    for (const pattern of forbidden) expect(migration).not.toMatch(pattern)
  })

  it('só cria tabelas com prefixo radar_', () => {
    const createdTables = [...migration.matchAll(/create table public\.(\w+)/g)].map((match) => match[1])
    expect(createdTables.length).toBeGreaterThan(0)
    for (const table of createdTables) expect(table.startsWith('radar_')).toBe(true)
  })

  it('referencia public.perfumes apenas como foreign key opcional (leitura), nunca grava nela', () => {
    expect(migration).toContain('perfume_id uuid references public.perfumes(id)')
    expect(migration).not.toMatch(/insert into public\.perfumes/i)
    expect(migration).not.toMatch(/update public\.perfumes/i)
  })
})

describe('link Estoque -> Radar não muda regras de estoque', () => {
  it('botão "Buscar reposição" apenas navega, nunca chama ajuste de estoque', () => {
    const buttonLine = inventoryPage.split('\n').find((line) => line.includes('Buscar reposição'))
    expect(buttonLine).toBeDefined()
    expect(buttonLine).toContain("pushState")
    expect(buttonLine).not.toContain('adjustInventory')
    expect(buttonLine).not.toContain('createInventoryItem')
  })

  it('funções de ajuste de estoque continuam intactas', () => {
    expect(inventoryPage).toContain('const adjust=async(row:InventoryRow,positive:boolean)=>')
    expect(inventoryPage).toContain('await adjustInventory(row.item_id,positive?amount:-amount,reason)')
  })
})
