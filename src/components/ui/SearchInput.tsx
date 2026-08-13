import { Search, X } from 'lucide-react'
import './SearchInput.css'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onClear?: () => void
  'aria-label'?: string
}

export function SearchInput({ value, onChange, placeholder, onClear, ...rest }: Props) {
  return (
    <div className="ui-search">
      <Search size={18} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={rest['aria-label'] ?? placeholder}
      />
      {value && (
        <button type="button" aria-label="Limpar busca" onClick={() => (onClear ? onClear() : onChange(''))}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}
