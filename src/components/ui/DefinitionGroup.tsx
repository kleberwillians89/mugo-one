import { ReactNode } from 'react'
import './DefinitionGroup.css'

type Item = { label: string; value: ReactNode }

type Props = {
  title: string
  items: Item[]
  action?: ReactNode
}

export function DefinitionGroup({ title, items, action }: Props) {
  return (
    <div className="ui-def-group">
      <div className="ui-def-group-head">
        <h4>{title}</h4>
        {action}
      </div>
      <dl>
        {items.map((item) => (
          <div className="ui-def-row" key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value === '' || item.value === null || item.value === undefined ? '—' : item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
