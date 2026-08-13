import { ReactNode, useRef } from 'react'
import { useFocusTrap } from './hooks/useFocusTrap'
import './Drawer.css'

type Props = {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right'
  children: ReactNode
  'aria-label': string
}

export function Drawer({ open, onClose, side = 'left', children, ...rest }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, panelRef, onClose)
  if (!open) return null
  return (
    <div className="ui-drawer-layer">
      <button className="ui-drawer-scrim" aria-label="Fechar menu" onClick={onClose} />
      <div ref={panelRef} className={`ui-drawer-panel ui-drawer-panel--${side}`} role="dialog" aria-modal="true" aria-label={rest['aria-label']}>
        {children}
      </div>
    </div>
  )
}
