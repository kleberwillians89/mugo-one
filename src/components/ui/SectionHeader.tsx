import { ReactNode } from 'react'
import './SectionHeader.css'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

export function SectionHeader({ title, description, action }: Props) {
  return (
    <div className="ui-section-header">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}
