import './Stepper.css'

type Props = {
  steps: string[]
  currentIndex: number
  compact?: boolean
}

/**
 * Generic horizontal mini-journey (e.g. "Produtos → Conferência → Frete →
 * ... → Entrega"). `currentIndex` marks the active step; everything before
 * it renders as done, everything after as upcoming. No technical status
 * strings ever get passed in — callers must translate to plain labels.
 */
export function Stepper({ steps, currentIndex, compact }: Props) {
  return (
    <ol className={`ui-stepper ${compact ? 'ui-stepper--compact' : ''}`}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
        return (
          <li key={step} className={`ui-stepper-item ui-stepper-item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ui-stepper-dot" aria-hidden="true" />
            <span className="ui-stepper-label">{step}</span>
          </li>
        )
      })}
    </ol>
  )
}
