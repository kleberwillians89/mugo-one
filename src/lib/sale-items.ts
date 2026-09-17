import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type SaleItemLine = {
  id: string | null
  catalogItemId: string | null
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountAmount: number
  totalAmount: number
  legacy: boolean
}

export type NewSaleItemInput = {
  catalogItemId?: string | null
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountAmount?: number
}

export type NewSaleInput = {
  clientId: string
  saleDate: string
  items: NewSaleItemInput[]
  paymentStatus: string
  paymentMethod?: string | null
  paidAt?: string | null
  ownerUserId?: string | null
  source?: string
  notes?: string | null
}

export type CreateSaleResult = { saleId: string; subtotal: number; discountTotal: number; totalAmount: number; itemCount: number }

/**
 * Cria a venda + itens atomicamente via RPC (ver
 * docs/SALES_CATALOG_MIGRATION_PLAN.md §5 — nunca calcula o total no
 * cliente para confiar cegamente; o servidor recalcula tudo). Substitui,
 * no fluxo ativo, o createSale() antigo (item único do domínio vertical
 * legado), que continua existindo só para a planilha operacional isolada
 * (ver src/legacy/spreadsheet/).
 */
export async function createSaleWithItems(input: NewSaleInput): Promise<CreateSaleResult> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('create_sale_with_items', {
    p_organization_id: organizationId,
    p_client_id: input.clientId,
    p_items: input.items.map((item) => ({
      catalog_item_id: item.catalogItemId ?? null,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unitPrice,
      discount_amount: item.discountAmount ?? 0,
    })),
    p_sale_date: input.saleDate,
    p_payment_status: input.paymentStatus,
    p_payment_method: input.paymentMethod || null,
    p_paid_at: input.paidAt || null,
    p_owner_user_id: input.ownerUserId || null,
    p_source: input.source ?? 'manual',
    p_notes: input.notes || null,
  })
  if (error) throw new Error(error.message)
  const result = data as { sale_id: string; subtotal: number; discount_total: number; total_amount: number; item_count: number }
  return { saleId: result.sale_id, subtotal: Number(result.subtotal), discountTotal: Number(result.discount_total), totalAmount: Number(result.total_amount), itemCount: result.item_count }
}

type SaleItemRow = { id: string; catalog_item_id: string | null; description: string; quantity: number; unit: string; unit_price: number; discount_amount: number; total_amount: number }

function toSaleItemLine(row: SaleItemRow): SaleItemLine {
  return { id: row.id, catalogItemId: row.catalog_item_id, description: row.description, quantity: Number(row.quantity), unit: row.unit, unitPrice: Number(row.unit_price), discountAmount: Number(row.discount_amount), totalAmount: Number(row.total_amount), legacy: false }
}

/**
 * Uma venda antiga (anterior a esta sprint) não tem linhas em
 * sale_items. Para ela, sintetiza EM MEMÓRIA (nunca grava no banco,
 * nunca inventa dado que não exista) uma linha única a partir dos
 * campos legados da própria venda — ver docs/SALES_CATALOG_MIGRATION_PLAN.md §4.
 */
export function legacySaleItemLine(sale: { perfume_name_raw: string | null; volume_ml: number | null; amount: number }): SaleItemLine {
  return {
    id: null,
    catalogItemId: null,
    description: sale.perfume_name_raw ?? 'Item não descrito',
    quantity: 1,
    unit: sale.volume_ml === null ? 'un' : 'ml',
    unitPrice: Number(sale.amount),
    discountAmount: 0,
    totalAmount: Number(sale.amount),
    legacy: true,
  }
}

export async function fetchSaleItems(saleId: string): Promise<SaleItemLine[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('sale_items').select('id,catalog_item_id,description,quantity,unit,unit_price,discount_amount,total_amount').eq('sale_id', saleId).order('position')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => toSaleItemLine(row as SaleItemRow))
}

export type SaleItemsSummary = { count: number; firstDescription: string; quantity: number; unit: string | null }

/**
 * Busca em lote (uma query para N vendas) o resumo de itens para
 * listagens (Vendas, Planilha) — evita N+1 query por linha da tabela.
 * Vendas sem linha em sale_items (legado) simplesmente não aparecem no
 * mapa devolvido; o chamador decide o fallback (ver Fase D/Planilha).
 * `unit` só vem preenchido quando TODOS os itens da venda usam a mesma
 * unidade — somar "3 un + 2 kg" não faz sentido, então nesse caso a
 * quantidade fica sem unidade neutra para o chamador decidir o texto
 * (ver itemsQuantityLabel).
 */
export async function fetchSaleItemsSummaries(saleIds: string[]): Promise<Map<string, SaleItemsSummary>> {
  const map = new Map<string, SaleItemsSummary>()
  if (!supabase || saleIds.length === 0) return map
  const { data, error } = await supabase.from('sale_items').select('sale_id,description,quantity,unit,position').in('sale_id', saleIds).order('position')
  if (error) throw new Error(error.message)
  for (const row of (data ?? []) as { sale_id: string; description: string; quantity: number; unit: string; position: number }[]) {
    const current = map.get(row.sale_id)
    if (!current) map.set(row.sale_id, { count: 1, firstDescription: row.description, quantity: Number(row.quantity), unit: row.unit })
    else {
      current.count += 1
      current.quantity += Number(row.quantity)
      if (current.unit !== row.unit) current.unit = null
    }
  }
  return map
}

/** "3 itens" quando há mais de um, nome do item quando há só um — nunca soma quantidades de unidades diferentes (ver briefing Fase F §24). */
export function itemsSummaryLabel(summary: SaleItemsSummary | undefined, legacyFallback: string): string {
  if (!summary) return legacyFallback
  if (summary.count === 1) return summary.firstDescription
  return `${summary.count} itens`
}

/** Soma quantidade só quando faz sentido (uma unidade só, ou um item só) — nunca "12 unidades" a partir de unidades incompatíveis. */
export function itemsQuantityLabel(summary: SaleItemsSummary | undefined, legacyFallback: string): string {
  if (!summary) return legacyFallback
  if (summary.unit === null) return `${summary.count} itens`
  return `${summary.quantity.toLocaleString('pt-BR')} ${summary.unit}`
}

export type SaleActivity = { id: string; activityType: string; title: string; description: string | null; createdAt: string }

/**
 * Timeline mínima da venda (Venda 360, §18/§10 da sprint de catálogo).
 * Lê direto de `activities` (já existe desde a Sprint 2 do CRM) — não é
 * um Event Engine novo, é o mecanismo de evento já disponível hoje,
 * reaproveitado (ver docs/SALES_CATALOG_MIGRATION_PLAN.md §6).
 */
export async function fetchSaleActivities(saleId: string): Promise<SaleActivity[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('activities').select('id,activity_type,title,description,created_at').eq('entity_type', 'sale').eq('entity_id', saleId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ id: row.id as string, activityType: row.activity_type as string, title: row.title as string, description: row.description as string | null, createdAt: row.created_at as string }))
}
