import { ReactNode } from 'react'
import './FormField.css'

type Props = {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
}

export function FormField({ label, htmlFor, error, hint, required, children }: Props) {
  return (
    <div className="ui-field">
      <label htmlFor={htmlFor}>
        {label}{required && <span className="ui-field-required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <span className="ui-field-hint">{hint}</span>}
      {error && <span className="ui-field-error" role="alert">{error}</span>}
    </div>
  )
}
