import { ReactNode, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from './hooks/useFocusTrap'
import './Modal.css'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'full'
}

export function Modal({ open, onClose, title, eyebrow, children, footer, size = 'md' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, panelRef, onClose)
  if (!open) return null
  const titleId = 'ui-modal-title'
  return (
    <div className="ui-modal-layer">
      <button className="ui-modal-scrim" aria-label="Fechar" onClick={onClose} />
      <div ref={panelRef} className={`ui-modal-panel ui-modal-panel--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-title">
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button aria-label="Fechar" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
