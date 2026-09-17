import {
  DaviColumnFilter, DaviExcelFilters, DaviExcelRow, DaviFilterKind, DaviSortLevel,
  fetchDaviExcel, fetchDaviExcelDistinct, fetchDaviExcelSaleEdit, softDeleteDaviSale, updateDaviExcelSale,
} from './records'
import { fetchSaleItemsSummaries, itemsSummaryLabel } from './sale-items'

/**
 * Adapter (padrão LegacySaleAdapter — ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §3) entre o registro
 * operacional legado (uma venda = um perfume = um frasco, `sales`/
 * `davi_excel_*` RPCs) e o modelo genérico de linha de planilha usado
 * pela Fase C. Nenhum nome "Davi" cruza esta fronteira para fora deste
 * arquivo — o resto do Core só conhece `SpreadsheetRow`.
 *
 * Uma venda antiga (perfume_id preenchido) tem `item`/`quantity`/`unit`
 * vindos do legado (perfume/ml); uma venda nova (Fase F,
 * create_sale_with_items) não tem perfume_id, então esses três campos
 * vêm de sale_items em vez disso — ver fetchSpreadsheetPage. Nenhum dos
 * dois casos é regra estrutural do tipo abaixo; `unit` nunca é só 'ml'.
 */
export type SpreadsheetRow = {
  id: string
  clientId: string
  clientNumber: number | null
  clientName: string
  date: string
  item: string | null
  quantity: number | null
  unit: string | null
  amount: number
  paymentStatus: string
  paymentMethod: string | null
  paidAt: string | null
  notes: string | null
  statusDisplay: string
  attachmentCount: number
}

export type SpreadsheetFilterKind = DaviFilterKind
export type SpreadsheetColumnFilter = DaviColumnFilter
export type SpreadsheetSortLevel = DaviSortLevel
export type SpreadsheetDistinctValue = { value: string; count: number }
export type SpreadsheetFilters = { search?: string; columns?: Record<string, SpreadsheetColumnFilter> }

export const SPREADSHEET_DEFAULT_SORT: SpreadsheetSortLevel[] = [{ column: 'sale_date', direction: 'asc' }]

/**
 * A RPC legada (`davi_excel_list_multi`/`davi_excel_distinct`) identifica
 * colunas por nomes fixos do domínio antigo ('perfume', 'volume') — filtro,
 * ordenação e busca de valores distintos todos passam essa string direto
 * pro banco. As colunas genéricas da Planilha ('item', 'quantity') viram
 * essas duas SÓ nesta tradução — nenhum outro arquivo novo desta fase
 * conhece 'perfume'/'volume'.
 */
const GENERIC_TO_LEGACY_COLUMN: Record<string, string> = { item: 'perfume', quantity: 'volume' }
const toLegacyColumn = (column: string) => GENERIC_TO_LEGACY_COLUMN[column] ?? column

function toSpreadsheetRow(row: DaviExcelRow): SpreadsheetRow {
  return {
    id: row.id,
    clientId: row.client_id,
    clientNumber: row.client_number,
    clientName: row.client_name,
    date: row.sale_date,
    item: row.perfume_name,
    quantity: row.volume_ml,
    unit: row.volume_ml === null ? null : 'ml',
    amount: row.amount,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    notes: row.notes,
    statusDisplay: row.shipping_deadline_display ?? row.operational_status,
    attachmentCount: row.attachment_count,
  }
}

function toLegacyFilters(filters: SpreadsheetFilters): DaviExcelFilters {
  const columns = filters.columns
  if (!columns) return { search: filters.search }
  return { search: filters.search, columns: Object.fromEntries(Object.entries(columns).map(([column, filter]) => [toLegacyColumn(column), filter])) }
}

function toLegacySorts(sorts: SpreadsheetSortLevel[]): DaviSortLevel[] {
  return sorts.map((level) => ({ ...level, column: toLegacyColumn(level.column) }))
}

/**
 * Vendas criadas pela Fase F (create_sale_with_items) não têm
 * perfume_id — chegam de `fetchDaviExcel` com item/quantity/unit nulos
 * (join à esquerda com perfumes, ver docs/SALES_CATALOG_MIGRATION_PLAN.md).
 * Para essas linhas (e só essas — uma query em lote, não N+1), busca o
 * resumo real em sale_items e preenche por cima, para que "novas vendas
 * aparecem na Planilha" signifique aparecer com o item certo, não em branco.
 */
export async function fetchSpreadsheetPage(filters: SpreadsheetFilters, page = 0, pageSize = 100, sorts: SpreadsheetSortLevel[] = SPREADSHEET_DEFAULT_SORT) {
  const result = await fetchDaviExcel(toLegacyFilters(filters), page, pageSize, toLegacySorts(sorts))
  const rows = result.rows.map(toSpreadsheetRow)
  const missingItemIds = rows.filter((row) => row.item === null).map((row) => row.id)
  if (missingItemIds.length > 0) {
    const summaries = await fetchSaleItemsSummaries(missingItemIds)
    for (const row of rows) {
      const summary = summaries.get(row.id)
      if (summary) {
        row.item = itemsSummaryLabel(summary, row.item ?? '—')
        // unit === null quer dizer "itens com unidades incompatíveis" —
        // mostra a contagem de itens em vez de somar quantidades que não
        // podem ser somadas (ver itemsQuantityLabel/briefing Fase F §24).
        row.quantity = summary.unit === null ? summary.count : summary.quantity
        row.unit = summary.unit ?? 'itens'
      }
    }
  }
  return { rows, total: result.total }
}

export async function fetchSpreadsheetDistinct(column: string, filters: SpreadsheetFilters, search = ''): Promise<{ values: SpreadsheetDistinctValue[]; total: number; has_more: boolean }> {
  return fetchDaviExcelDistinct(toLegacyColumn(column), toLegacyFilters(filters), search)
}

/** Campos genéricos e seguros para edição inline nesta fase — ver a nota do módulo sobre o que ainda não é editável aqui. */
export type SpreadsheetRowEdit = { date: string; amount: string; paymentStatus: string; paymentMethod: string; paidAt: string; notes: string }

export async function fetchSpreadsheetRowEdit(rowId: string): Promise<{ edit: SpreadsheetRowEdit; updatedAt: string }> {
  const sale = await fetchDaviExcelSaleEdit(rowId)
  return {
    edit: { date: sale.sale_date, amount: String(sale.amount ?? ''), paymentStatus: sale.payment_status, paymentMethod: sale.payment_method ?? '', paidAt: sale.paid_at ?? '', notes: sale.notes ?? '' },
    updatedAt: sale.updated_at,
  }
}

export async function updateSpreadsheetRow(rowId: string, patch: Partial<Record<'sale_date' | 'amount' | 'payment_status' | 'payment_method' | 'paid_at' | 'notes', unknown>>, expectedUpdatedAt: string) {
  return updateDaviExcelSale(rowId, patch, expectedUpdatedAt)
}

export async function deleteSpreadsheetRow(rowId: string, expectedUpdatedAt: string, reason: Parameters<typeof softDeleteDaviSale>[2], note?: string) {
  return softDeleteDaviSale(rowId, expectedUpdatedAt, reason, note)
}

/**
 * SalePaymentAttachmentsModal (componente compartilhado, fora do escopo
 * desta fase) ainda espera o formato antigo de resumo de venda — esta
 * tradução fica aqui, na fronteira, para que src/pages/SpreadsheetPage.tsx
 * nunca precise escrever o nome do campo legado diretamente.
 */
export function toLegacyAttachmentSaleSummary(row: SpreadsheetRow) {
  return { id: row.id, client_name: row.clientName, sale_date: row.date, perfume_name: row.item, amount: row.amount, payment_status: row.paymentStatus }
}
