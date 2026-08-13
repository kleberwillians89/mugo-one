import { useId } from 'react'
import { FormField } from './FormField'
import './Select.css'

type Option = { value: string; label: string }

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  error?: string
  required?: boolean
}

export function Select({ label, value, onChange, options, placeholder, error, required }: Props) {
  const id = useId()
  return (
    <FormField label={label} htmlFor={id} error={error} required={required}>
      <select id={id} className="ui-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FormField>
  )
}
