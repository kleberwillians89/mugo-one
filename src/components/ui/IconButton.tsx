import { ButtonHTMLAttributes } from 'react'
import { LucideIcon } from 'lucide-react'
import './IconButton.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  'aria-label': string
  variant?: 'default' | 'ghost'
  badge?: boolean
}

export function IconButton({ icon: Icon, variant = 'default', badge, className = '', ...rest }: Props) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={`ui-icon-btn ui-icon-btn--${variant} ${badge ? 'ui-icon-btn--badge' : ''} ${className}`.trim()}
    >
      <Icon size={20} />
    </button>
  )
}
