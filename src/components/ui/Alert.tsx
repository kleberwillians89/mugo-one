import { ReactNode } from 'react'
import { AlertTriangle, Check, Info, LucideIcon, OctagonAlert } from 'lucide-react'
import './Alert.css'

type Tone = 'info' | 'warning' | 'danger' | 'success'

const defaultIcons: Record<Tone, LucideIcon> = { info: Info, warning: AlertTriangle, danger: OctagonAlert, success: Check }

type Props = {
  tone: Tone
  title?: string
  children: ReactNode
  icon?: LucideIcon
}

export function Alert({ tone, title, children, icon }: Props) {
  const Icon = icon ?? defaultIcons[tone]
  return (
    <div className={`ui-alert ui-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div>
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </div>
    </div>
  )
}
