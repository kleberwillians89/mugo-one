import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Download, Filter, Paperclip, Save, Search, SlidersHorizontal, X } from 'lucide-react'
import { shortDate } from '../lib/format'
import { exportCsv } from '../lib/csv'
import { useHasPermission } from '../lib/PermissionsContext'
import { SalePaymentAttachmentsModal } from '../components/SalePaymentAttachmentsModal'
import { SpreadsheetColumnDef, SpreadsheetColumnFilterMenu } from '../components/spreadsheet/SpreadsheetColumnFilterMenu'
import { SpreadsheetSortModal } from '../components/spreadsheet/SpreadsheetSortModal'
import { useToast } from '../components/ui'
import {
  SPREADSHEET_DEFAULT_SORT, SpreadsheetColumnFilter, SpreadsheetFilters, SpreadsheetRow, SpreadsheetRowEdit, SpreadsheetSortLevel,
  fetchSpreadsheetDistinct, fetchSpreadsheetPage, fetchSpreadsheetRowEdit, toLegacyAttachmentSaleSummary, updateSpreadsheetRow,
} from '../lib/spreadsheet-adapter'
import './SpreadsheetPage.css'

/**
 * Planilha operacional genérica (Fase C da generalização — ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §2-4). Sucessora do
 * "Davi Excel" (isolado em src/legacy/spreadsheet/): mesma tecnologia
 * de grade (filtro por coluna, ordenação multinível, edição inline,
 * exportação, anexos, paginação, persistência de estado), mas sem
 * nenhum nome de pessoa e sem colunas nascidas do domínio vertical
 * antigo — o conjunto de colunas é o genérico do briefing (Cliente, Data,
 * Item, Quantidade, Unidade, Valor, Pagamento, Forma de pagamento,
 * Observações, Anexos).
 *
 * Edição inline nesta fase cobre só os campos genéricos e seguros
 * (Data, Valor, Pagamento, Forma de pagamento, Data de pagamento,
 * Observações) — Item/Quantidade/Unidade ainda vêm do registro
 * operacional legado (via src/lib/spreadsheet-adapter.ts) e só ficam
 * editáveis aqui quando o modelo genérico Produto/Serviço + Sale Items
 * existir (Fase E). Não fingimos que já são editáveis.
 */

const columns: SpreadsheetColumnDef[] = [
  { key: 'client', label: 'CLIENTE', kind: 'text', sort: 'client' },
  { key: 'sale_date', label: 'DATA', kind: 'date', sort: 'sale_date' },
  { key: 'item', label: 'ITEM', kind: 'text', sort: 'item' },
  { key: 'quantity', label: 'QUANTIDADE', kind: 'number', sort: 'quantity' },
  { key: 'amount', label: 'VALOR', kind: 'number', sort: 'amount' },
  { key: 'payment', label: 'PAGAMENTO', kind: 'text', sort: 'payment' },
  { key: 'method', label: 'FORMA DE PAGAMENTO', kind: 'text', sort: 'method' },
  { key: 'paid_at', label: 'DATA PAGMT', kind: 'date', sort: 'paid_at' },
  { key: 'notes', label: 'OBSERVAÇÃO', kind: 'text', sort: 'notes' },
]

const paymentLabel: Record<string, string> = { paid: 'PAGO', pending: 'AGUARDANDO', cancelled: 'CANCELADO', unknown: 'DESCONHECIDO' }
const money = (value: number | null) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0))
const valueLabelFor = (column: string) => (value: string) => value === '__BLANK__' ? 'Em branco' : column === 'payment' ? (paymentLabel[value] ?? value) : columns.find((item) => item.key === column)?.kind === 'date' ? shortDate(value) : value

const STORAGE_KEY = 'mugo_one_spreadsheet_state'
const savedState = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { filters?: SpreadsheetFilters; sorts?: SpreadsheetSortLevel[] } } catch { return {} } }

function RowEditor({ row, onSaved, onCancel }: { row: SpreadsheetRow; onSaved: () => void; onCancel: () => void }) {
  const toast = useToast()
  const [source, setSource] = useState<{ edit: SpreadsheetRowEdit; updatedAt: string } | null>(null)
  const [draft, setDraft] = useState<SpreadsheetRowEdit | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { fetchSpreadsheetRowEdit(row.id).then((result) => { setSource(result); setDraft(result.edit) }).catch((reason) => toast.push(reason instanceof Error ? reason.message : 'Não foi possível abrir a edição.', { tone: 'error' })) }, [row.id, toast])
  if (!draft || !source) return <tr><td colSpan={11} className="spreadsheet-row-loading">Carregando edição…</td></tr>
  const patch = (next: Partial<SpreadsheetRowEdit>) => setDraft((current) => (current ? { ...current, ...next } : current))
  const save = async () => {
    setSaving(true)
    try {
      const next: Record<string, unknown> = {}
      if (draft.date !== source.edit.date) next.sale_date = draft.date
      if (draft.amount !== source.edit.amount) next.amount = draft.amount
      if (draft.paymentStatus !== source.edit.paymentStatus) next.payment_status = draft.paymentStatus
      if (draft.paymentMethod !== source.edit.paymentMethod) next.payment_method = draft.paymentMethod || null
      if (draft.paidAt !== source.edit.paidAt) next.paid_at = draft.paidAt || null
      if (draft.notes !== source.edit.notes) next.notes = draft.notes || null
      if (Object.keys(next).length) await updateSpreadsheetRow(row.id, next, source.updatedAt)
      toast.push('Linha atualizada.', { tone: 'success' })
      onSaved()
    } catch (reason) {
      toast.push(reason instanceof Error ? reason.message : 'Não foi possível salvar.', { tone: 'error' })
    } finally { setSaving(false) }
  }
  return (
    <tr className="spreadsheet-editing-row">
      <td><strong>{row.clientName}</strong></td>
      <td><input aria-label="Data" type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} /></td>
      <td>{row.item ?? '—'}</td>
      <td>{row.quantity === null ? '—' : `${row.quantity} ${row.unit ?? ''}`}</td>
      <td><input aria-label="Valor" type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => patch({ amount: e.target.value })} /></td>
      <td><select aria-label="Pagamento" value={draft.paymentStatus} onChange={(e) => patch({ paymentStatus: e.target.value })}>{['paid', 'pending', 'cancelled', 'unknown'].map((value) => <option value={value} key={value}>{paymentLabel[value]}</option>)}</select></td>
      <td><input aria-label="Forma de pagamento" value={draft.paymentMethod} onChange={(e) => patch({ paymentMethod: e.target.value })} /></td>
      <td><input aria-label="Data pagamento" type="date" value={draft.paidAt} onChange={(e) => patch({ paidAt: e.target.value })} /></td>
      <td><textarea aria-label="Observação" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} /></td>
      <td>{row.attachmentCount}</td>
      <td><button disabled={saving} onClick={() => void save()}><Save size={14} />SALVAR</button><button disabled={saving} onClick={onCancel}><X size={14} />CANCELAR</button></td>
    </tr>
  )
}

export function SpreadsheetPage() {
  const [initial] = useState(savedState)
  const canEdit = useHasPermission('sales.edit')
  const [rows, setRows] = useState<SpreadsheetRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<SpreadsheetFilters>(initial.filters ?? {})
  const [search, setSearch] = useState(initial.filters?.search ?? '')
  const [sorts, setSorts] = useState<SpreadsheetSortLevel[]>(initial.sorts?.length ? initial.sorts : SPREADSHEET_DEFAULT_SORT)
  const [open, setOpen] = useState<string | null>(null)
  const [showSort, setShowSort] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [attachmentRow, setAttachmentRow] = useState<SpreadsheetRow | null>(null)

  useEffect(() => { const timer = setTimeout(() => { setPage(0); setFilters((current) => ({ ...current, search: search || undefined })) }, 300); return () => clearTimeout(timer) }, [search])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, sorts })) }, [filters, sorts])
  const load = useCallback(() => fetchSpreadsheetPage(filters, page, 100, sorts).then((result) => { setRows(result.rows); setTotal(result.total) }).finally(() => setLoading(false)), [filters, page, sorts])
  useEffect(() => { void load() }, [load])

  const activeCount = Object.keys(filters.columns ?? {}).length + (filters.search ? 1 : 0)
  const applyColumn = (key: string, filter?: SpreadsheetColumnFilter) => { setPage(0); setFilters((current) => { const next = { ...(current.columns ?? {}) }; if (filter) next[key] = filter; else delete next[key]; return { ...current, columns: Object.keys(next).length ? next : undefined } }); setOpen(null) }
  const clearAll = () => { setSearch(''); setFilters({}); setPage(0); setOpen(null) }
  const applySort = (levels: SpreadsheetSortLevel[]) => { setSorts(levels.slice(0, 5)); setPage(0); setOpen(null); setShowSort(false) }
  const clearSort = () => { setSorts(SPREADSHEET_DEFAULT_SORT); setPage(0); setOpen(null) }
  const exportAll = async () => {
    const all: SpreadsheetRow[] = []
    for (let index = 0; ; index++) { const result = await fetchSpreadsheetPage(filters, index, 500, sorts); all.push(...result.rows); if (all.length >= result.total) break }
    exportCsv('planilha.csv', all.map((row) => ({ Cliente: row.clientName, Data: shortDate(row.date), Item: row.item, Quantidade: row.quantity, Unidade: row.unit, Valor: row.amount, Pagamento: paymentLabel[row.paymentStatus] ?? row.paymentStatus, 'Forma de pagamento': row.paymentMethod, 'Data pagamento': row.paidAt ? shortDate(row.paidAt) : '', Observação: row.notes, Status: row.statusDisplay })))
  }
  const updateAttachmentCount = useCallback((count: number) => setRows((current) => current.map((row) => (row.id === attachmentRow?.id ? { ...row, attachmentCount: count } : row))), [attachmentRow?.id])

  return (
    <div className="page spreadsheet">
      {showSort && <SpreadsheetSortModal current={sorts} columns={columns} defaultSort={SPREADSHEET_DEFAULT_SORT} onApply={applySort} onClose={() => setShowSort(false)} />}
      {attachmentRow && <SalePaymentAttachmentsModal sale={toLegacyAttachmentSaleSummary(attachmentRow)} canManage={canEdit} onClose={() => setAttachmentRow(null)} onCount={updateAttachmentCount} />}
      <header className="spreadsheet-title">
        <div><span>REGISTROS OPERACIONAIS</span><h1>Planilha</h1><p>{total.toLocaleString('pt-BR')} itens encontrados{canEdit ? ' · Clique em Editar para alterar uma linha' : ''}</p></div>
        <div className="spreadsheet-actions">
          <button onClick={() => setShowSort(true)}><SlidersHorizontal size={16} />CLASSIFICAR</button>
          <button onClick={() => void exportAll()}><Download size={16} />EXPORTAR</button>
        </div>
      </header>

      <section className="spreadsheet-toolbar">
        <div className="spreadsheet-toolbar-filters">
          <label><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, item ou observação" /></label>
        </div>
        <div className="spreadsheet-toolbar-meta">
          <span>{total.toLocaleString('pt-BR')} resultados · Página {page + 1} de {Math.max(1, Math.ceil(total / 100))}</span>
          <button disabled={!activeCount} onClick={clearAll}>LIMPAR FILTROS {activeCount ? `(${activeCount})` : ''}</button>
          <button onClick={clearSort}>LIMPAR CLASSIFICAÇÃO</button>
        </div>
      </section>

      <div className="spreadsheet-grid" aria-busy={loading}>
        <table>
          <thead><tr>
            {columns.map((column) => {
              const active = filters.columns?.[column.key]
              const sortIndex = sorts.findIndex((level) => level.column === column.sort)
              const sortLevel = sortIndex >= 0 ? sorts[sortIndex] : null
              return (
                <th key={column.key} data-column={column.key}>
                  <button className={`spreadsheet-filter-trigger ${active ? 'active' : ''}`} title={active ? 'Filtro ativo' : `Filtrar ${column.label}`} aria-expanded={open === column.key} onClick={() => setOpen((current) => (current === column.key ? null : column.key))}>
                    <span>{column.label}{sortLevel && <i className="spreadsheet-sort-indicator">{sortLevel.direction === 'asc' ? '↑' : '↓'} {sortIndex + 1}</i>}</span>
                    {active ? <Filter size={13} fill="currentColor" /> : <ChevronDown size={13} />}
                  </button>
                  {open === column.key && <SpreadsheetColumnFilterMenu column={column} filters={filters} active={active} valueLabel={valueLabelFor(column.key)} fetchDistinct={fetchSpreadsheetDistinct} onApply={(filter) => applyColumn(column.key, filter)} onClose={() => setOpen(null)} />}
                </th>
              )
            })}
            <th>ANEXOS</th><th className="spreadsheet-actions-header">AÇÕES</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => editingId === row.id
              ? <RowEditor key={row.id} row={row} onSaved={() => { setEditingId(null); void load() }} onCancel={() => setEditingId(null)} />
              : <tr key={row.id}>
                  <td><strong>{row.clientName}</strong></td>
                  <td>{shortDate(row.date)}</td>
                  <td>{row.item ?? '—'}</td>
                  <td>{row.quantity === null ? '—' : `${row.quantity} ${row.unit ?? ''}`}</td>
                  <td>{money(row.amount)}</td>
                  <td><span className={`badge ${row.paymentStatus}`}>{paymentLabel[row.paymentStatus] ?? row.paymentStatus}</span></td>
                  <td>{row.paymentMethod ?? '—'}</td>
                  <td>{row.paidAt ? shortDate(row.paidAt) : '—'}</td>
                  <td>{row.notes ?? '—'}</td>
                  <td><button className="spreadsheet-attachment-count" onClick={() => setAttachmentRow(row)} aria-label={`${row.attachmentCount} anexos`}><Paperclip />{row.attachmentCount}</button></td>
                  <td>{canEdit && <button onClick={() => setEditingId(row.id)}>Editar</button>}</td>
                </tr>)}
          </tbody>
        </table>
        {!loading && !rows.length && <p className="spreadsheet-empty">Nenhum registro encontrado.</p>}
      </div>
      <footer className="spreadsheet-pages"><span>{total.toLocaleString('pt-BR')} resultados</span><button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {Math.max(1, Math.ceil(total / 100))}</span><button disabled={(page + 1) * 100 >= total} onClick={() => setPage(page + 1)}>Próxima</button></footer>
    </div>
  )
}
