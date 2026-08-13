import { LucideIcon } from 'lucide-react'
import { PrimaryButton } from './Button'
import './EmptyState.css'

type Props = {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-icon"><Icon /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <PrimaryButton onClick={action.onClick}>{action.label}</PrimaryButton>}
    </div>
  )
}
