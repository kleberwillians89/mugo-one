import { useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Modal } from '../ui'
import { SpreadsheetSortLevel } from '../../lib/spreadsheet-adapter'
import { SpreadsheetColumnDef } from './SpreadsheetColumnFilterMenu'

const sortOrderLabel = (column: SpreadsheetColumnDef, direction: 'asc' | 'desc') =>
  column.kind === 'text' ? (direction === 'asc' ? 'A → Z' : 'Z → A')
    : column.kind === 'date' ? (direction === 'asc' ? 'Mais antigo → Mais novo' : 'Mais novo → Mais antigo')
    : (direction === 'asc' ? 'Menor → Maior' : 'Maior → Menor')

/** Modal de ordenação em múltiplos níveis extraído do "Davi Excel" — genérico, sem nenhum campo de venda hardcoded. */
export function SpreadsheetSortModal({ current, columns, defaultSort, onApply, onClose }: {
  current: SpreadsheetSortLevel[]
  columns: SpreadsheetColumnDef[]
  defaultSort: SpreadsheetSortLevel[]
  onApply: (levels: SpreadsheetSortLevel[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SpreadsheetSortLevel[]>(current.length ? current : defaultSort)
  const change = (index: number, next: Partial<SpreadsheetSortLevel>) => setDraft((levels) => levels.map((level, i) => (i === index ? { ...level, ...next } : level)))
  const move = (index: number, direction: -1 | 1) => setDraft((levels) => { const target = index + direction; if (target < 0 || target >= levels.length) return levels; const next = [...levels]; [next[index], next[target]] = [next[target], next[index]]; return next })
  return (
    <Modal open onClose={onClose} eyebrow="PLANILHA" title="Classificar" footer={<><button onClick={onClose}>CANCELAR</button><button onClick={() => onApply(draft)}>APLICAR</button></>}>
      <div className="spreadsheet-sort-modal">
        <button className="spreadsheet-sort-preset" onClick={() => setDraft(defaultSort)}>ORDEM PADRÃO</button>
        {draft.map((level, index) => {
          const column = columns.find((item) => item.sort === level.column) ?? columns[0]
          return (
            <div className="spreadsheet-sort-level" key={`${index}-${level.column}`}>
              <strong>{index === 0 ? 'CLASSIFICAR POR' : 'E DEPOIS POR'} <i>{index + 1}</i></strong>
              <select aria-label={`Coluna nível ${index + 1}`} value={level.column} onChange={(event) => change(index, { column: event.target.value })}>
                {columns.map((item) => <option key={item.sort} value={item.sort}>{item.label}</option>)}
              </select>
              <select aria-label={`Ordem nível ${index + 1}`} value={level.direction} onChange={(event) => change(index, { direction: event.target.value as 'asc' | 'desc' })}>
                <option value="asc">{sortOrderLabel(column, 'asc')}</option>
                <option value="desc">{sortOrderLabel(column, 'desc')}</option>
              </select>
              <button aria-label="Subir nível" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></button>
              <button aria-label="Descer nível" disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button>
              <button aria-label="Remover nível" disabled={draft.length === 1} onClick={() => setDraft((levels) => levels.filter((_, i) => i !== index))}><X /></button>
            </div>
          )
        })}
        <button disabled={draft.length >= 5} onClick={() => setDraft((levels) => [...levels, { column: columns[0].sort, direction: 'asc' }])}>+ ADICIONAR NÍVEL</button>
      </div>
    </Modal>
  )
}
