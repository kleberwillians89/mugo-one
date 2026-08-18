import { ReactNode } from 'react'
import './Table.css'

type Column<T> = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  render?: (row: T) => ReactNode
  /** Secondary info that can stay hidden in the stacked mobile card view (<640px) to keep the card scannable. Never used for the primary/action columns. */
  hideOnMobile?: boolean
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyState?: ReactNode
}

export function Table<T extends Record<string, unknown>>({ columns, rows, rowKey, onRowClick, emptyState }: Props<T>) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.key} style={{ textAlign: column.align ?? 'left' }}>{column.label}</th>)}</tr>
        </thead>
        <tbody className="ui-table-body">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'ui-table-row--clickable' : ''}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter') onRowClick(row) } : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} data-label={column.label} className={column.hideOnMobile ? 'ui-table-col--hide-mobile' : undefined} style={{ textAlign: column.align ?? 'left' }}>
                  {column.render ? column.render(row) : String(row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
