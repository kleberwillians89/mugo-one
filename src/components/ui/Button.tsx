import { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import './Button.css'

type BaseProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  loading?: boolean
  fullWidth?: boolean
  icon?: ReactNode
}

function BaseButton({ variant, children, loading, fullWidth, icon, disabled, className = '', ...rest }: BaseProps & { variant: 'primary' | 'secondary' | 'danger' }) {
  const blocked = disabled || loading
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={blocked}
      aria-busy={loading || undefined}
      className={`ui-btn ui-btn--${variant} ${fullWidth ? 'ui-btn--full' : ''} ${className}`.trim()}
    >
      {loading ? <LoaderCircle className="ui-btn-spin" size={16} /> : icon}
      <span>{children}</span>
    </button>
  )
}

export function PrimaryButton(props: BaseProps) {
  return <BaseButton {...props} variant="primary" />
}

export function SecondaryButton(props: BaseProps) {
  return <BaseButton {...props} variant="secondary" />
}

export function DangerButton(props: BaseProps) {
  return <BaseButton {...props} variant="danger" />
}
