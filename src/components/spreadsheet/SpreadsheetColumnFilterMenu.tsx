import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { SpreadsheetColumnFilter, SpreadsheetDistinctValue, SpreadsheetFilterKind, SpreadsheetFilters } from '../../lib/spreadsheet-adapter'

/**
 * Motor de filtro por coluna extraído do "Davi Excel" (ver
 * docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §3-4) — mesma tecnologia
 * (filtro por condição + filtro por valores distintos com busca e
 * paginação), agora genérico: não conhece nenhum campo específico de
 * venda, recebe tudo por prop.
 */
export type SpreadsheetColumnDef = { key: string; label: string; kind: SpreadsheetFilterKind; sort: string }

const conditionOptions: Record<SpreadsheetFilterKind, [string, string][]> = {
  text: [['contains', 'Contém'], ['not_contains', 'Não contém'], ['starts_with', 'Começa com'], ['ends_with', 'Termina com'], ['equals', 'É exatamente']],
  date: [['eq', 'É igual a'], ['before', 'Antes de'], ['after', 'Depois de'], ['between', 'Entre']],
  number: [['eq', 'Igual a'], ['gt', 'Maior que'], ['gte', 'Maior ou igual'], ['lt', 'Menor que'], ['lte', 'Menor ou igual'], ['between', 'Entre']],
}

export function SpreadsheetColumnFilterMenu({ column, filters, active, valueLabel, fetchDistinct, onApply, onClose }: {
  column: SpreadsheetColumnDef
  filters: SpreadsheetFilters
  active?: SpreadsheetColumnFilter
  valueLabel?: (value: string) => string
  fetchDistinct: (column: string, filters: SpreadsheetFilters, search: string) => Promise<{ values: SpreadsheetDistinctValue[]; total: number; has_more: boolean }>
  onApply: (filter?: SpreadsheetColumnFilter) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<SpreadsheetColumnFilter>(() => structuredClone(active ?? {}))
  const [query, setQuery] = useState('')
  const [values, setValues] = useState<SpreadsheetDistinctValue[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const attach = (node: HTMLDivElement | null) => {
    ref.current = node
    if (node) {
      const rect = node.parentElement?.getBoundingClientRect()
      if (rect) { node.style.top = `${Math.min(rect.bottom, window.innerHeight - 90)}px`; node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 352))}px` }
    }
  }
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [onClose])
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      setLoading(true)
      fetchDistinct(column.key, filters, query).then((result) => { if (live) { setValues(result.values); setTotal(result.total); setHasMore(result.has_more) } }).finally(() => { if (live) setLoading(false) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [column.key, filters, query, fetchDistinct])
  const selected = draft.values, allSelected = selected === undefined
  const toggle = (value: string) => setDraft((current) => { const base = current.values ?? values.map((item) => item.value), next = base.includes(value) ? base.filter((item) => item !== value) : [...base, value]; return { ...current, values: next } })
  const condition = draft.condition ?? { operator: '', value: '', value2: '' }, between = condition.operator === 'between'
  const setCondition = (patch: Partial<NonNullable<SpreadsheetColumnFilter['condition']>>) => setDraft((current) => ({ ...current, condition: { ...condition, ...patch } }))
  const apply = () => { const normalized: SpreadsheetColumnFilter = {}; if (draft.values !== undefined) normalized.values = draft.values; if (draft.condition?.operator && draft.condition.value) normalized.condition = draft.condition; onApply(Object.keys(normalized).length ? normalized : undefined) }
  const label = (value: string) => valueLabel ? valueLabel(value) : value
  return (
    <div className="spreadsheet-filter-menu" ref={attach} role="dialog" aria-label={`Filtro de ${column.label}`}>
      <fieldset><legend>FILTRAR POR CONDIÇÃO</legend>
        <select aria-label="Condição" value={condition.operator} onChange={(e) => setCondition({ operator: e.target.value })}>
          <option value="">Nenhuma condição</option>
          {conditionOptions[column.kind].map(([value, cLabel]) => <option key={value} value={value}>{cLabel}</option>)}
        </select>
        {condition.operator && <div className="spreadsheet-condition-values">
          <input aria-label="Valor da condição" type={column.kind === 'date' ? 'date' : column.kind === 'number' ? 'number' : 'text'} value={condition.value ?? ''} onChange={(e) => setCondition({ value: e.target.value })} />
          {between && <input aria-label="Segundo valor da condição" type={column.kind === 'date' ? 'date' : column.kind === 'number' ? 'number' : 'text'} value={condition.value2 ?? ''} onChange={(e) => setCondition({ value2: e.target.value })} />}
        </div>}
      </fieldset>
      <fieldset><legend>FILTRAR POR VALORES</legend>
        <label className="spreadsheet-value-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Buscar ${column.label.toLowerCase()}…`} /></label>
        <label className="spreadsheet-check"><input type="checkbox" checked={allSelected} onChange={(e) => setDraft((current) => ({ ...current, values: e.target.checked ? undefined : [] }))} /><span>Selecionar todos</span></label>
        <div className="spreadsheet-values" aria-busy={loading}>
          {values.map((item) => <label className="spreadsheet-check" key={item.value}><input type="checkbox" checked={allSelected || Boolean(selected?.includes(item.value))} onChange={() => toggle(item.value)} /><span>{label(item.value)}</span><small>{item.count}</small></label>)}
          {!loading && !values.length && <p>Nenhum valor encontrado.</p>}
        </div>
        {hasMore && <small className="spreadsheet-more">Mostrando {values.length} de {total}. Use a busca para localizar outros valores.</small>}
      </fieldset>
      <footer><button onClick={() => onApply(undefined)}>LIMPAR FILTRO DESTA COLUNA</button><button className="apply" onClick={apply}>APLICAR</button></footer>
    </div>
  )
}
