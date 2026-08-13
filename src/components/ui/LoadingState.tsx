import { LoaderCircle } from 'lucide-react'
import './LoadingState.css'

type Props = {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  fullHeight?: boolean
}

const sizes = { sm: 18, md: 26, lg: 34 }

export function LoadingState({ label = 'Carregando…', size = 'md', fullHeight }: Props) {
  return (
    <div className={`ui-loading ${fullHeight ? 'ui-loading--full' : ''}`} role="status" aria-live="polite">
      <LoaderCircle size={sizes[size]} className="ui-loading-spin" />
      <span>{label}</span>
    </div>
  )
}
