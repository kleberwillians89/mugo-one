import { ReactNode } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import './ScanFeedback.css'

type Tone = 'success' | 'warning' | 'error'

const ICONS: Record<Tone, typeof Check> = { success: Check, warning: AlertTriangle, error: X }

/**
 * Feedback visual grande e inequívoco de um bipe/leitura (briefing seção
 * 12): verde = reconhecido/correto, amarelo = atenção (já conferido,
 * volume insuficiente), vermelho = não reconhecido/errado. Um componente
 * só, reaproveitado em qualquer tela que precise dessa mesma linguagem
 * visual — não reinventar cor/ícone por tela.
 */
export function ScanFeedback({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const Icon = ICONS[tone]
  return (
    <div className={`scan-feedback scan-feedback--${tone}`} role="status">
      <Icon size={22} aria-hidden="true" />
      <div className="scan-feedback-body">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  )
}
