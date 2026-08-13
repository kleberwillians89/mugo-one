import { HTMLAttributes, ReactNode } from 'react'
import './Card.css'

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  padding?: 'sm' | 'md' | 'lg'
}

export function Card({ children, padding = 'md', className = '', ...rest }: Props) {
  return (
    <div {...rest} className={`ui-card ui-card--${padding} ${className}`.trim()}>
      {children}
    </div>
  )
}
