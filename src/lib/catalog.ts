import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type CatalogItemType = 'product' | 'service'

export type CatalogItem = {
  id: string
  type: CatalogItemType
  name: string
  sku: string | null
  description: string | null
  category: string | null
  unit: string
  price: number
  cost: number | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Sugestões de unidade — texto livre no banco (ver docs/SALES_CATALOG_MIGRATION_PLAN.md §3), isto é só conveniência de formulário. */
export const UNIT_SUGGESTIONS = ['un', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'hour', 'day', 'session', 'package', 'month', 'service'] as const

const UNIT_LABEL: Record<string, string> = {
  un: 'unidade', kg: 'kg', g: 'g', l: 'litro', ml: 'ml', m: 'm', cm: 'cm',
  hour: 'hora', day: 'diária', session: 'sessão', package: 'pacote', month: 'mês', service: 'serviço',
}
export const unitLabel = (unit: string) => UNIT_LABEL[unit] ?? unit

type CatalogItemRow = {
  id: string; type: CatalogItemType; name: string; sku: string | null; description: string | null
  category: string | null; unit: string; price: number; cost: number | null; active: boolean
  created_at: string; updated_at: string
}

function toCatalogItem(row: CatalogItemRow): CatalogItem {
  return { id: row.id, type: row.type, name: row.name, sku: row.sku, description: row.description, category: row.category, unit: row.unit, price: Number(row.price), cost: row.cost === null ? null : Number(row.cost), active: row.active, createdAt: row.created_at, updatedAt: row.updated_at }
}

const COLUMNS = 'id,type,name,sku,description,category,unit,price,cost,active,created_at,updated_at'

export async function fetchCatalogItems(options: { search?: string; type?: CatalogItemType; activeOnly?: boolean } = {}): Promise<CatalogItem[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  let query = supabase.from('catalog_items').select(COLUMNS).eq('organization_id', organizationId).order('name')
  if (options.type) query = query.eq('type', options.type)
  if (options.activeOnly) query = query.eq('active', true)
  if (options.search && options.search.trim()) query = query.ilike('name', `%${options.search.trim()}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toCatalogItem(row as CatalogItemRow))
}

/** Busca para o EntityCombobox de itens na Nova Venda — inclui preço/unidade na descrição para já sugerir o valor ao selecionar. */
export async function searchCatalogItems(term: string): Promise<CatalogItem[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('catalog_items').select(COLUMNS).eq('organization_id', organizationId).eq('active', true).ilike('name', `%${term}%`).order('name').limit(12)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toCatalogItem(row as CatalogItemRow))
}

export type CatalogItemInput = { type: CatalogItemType; name: string; sku?: string; description?: string; category?: string; unit: string; price: number; cost?: number | null }

export async function createCatalogItem(input: CatalogItemInput): Promise<CatalogItem> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('catalog_items').insert({
    organization_id: organizationId, type: input.type, name: input.name.trim(), sku: input.sku?.trim() || null,
    description: input.description?.trim() || null, category: input.category?.trim() || null,
    unit: input.unit || 'un', price: input.price, cost: input.cost ?? null,
  }).select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return toCatalogItem(data as CatalogItemRow)
}

export async function updateCatalogItem(id: string, input: Partial<CatalogItemInput> & { active?: boolean }): Promise<CatalogItem> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const patch: Record<string, unknown> = {}
  if (input.type !== undefined) patch.type = input.type
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.sku !== undefined) patch.sku = input.sku?.trim() || null
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.category !== undefined) patch.category = input.category?.trim() || null
  if (input.unit !== undefined) patch.unit = input.unit
  if (input.price !== undefined) patch.price = input.price
  if (input.cost !== undefined) patch.cost = input.cost
  if (input.active !== undefined) patch.active = input.active
  const { data, error } = await supabase.from('catalog_items').update(patch).eq('id', id).select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return toCatalogItem(data as CatalogItemRow)
}
