import { ReactNode } from 'react'
import './StatusBadge.css'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}
