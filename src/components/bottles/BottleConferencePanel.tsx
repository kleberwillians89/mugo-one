import { useState } from 'react'
import { Check, Package } from 'lucide-react'
import { BottleResolution, ConferenceResult, confirmBottleConference } from '../../lib/inventory-bottles'
import { apcLabel, computeConferenceDiff, formatDelta, formatMl } from '../../lib/bottle-scan'
import './BottleConferencePanel.css'

type Props = {
  bottle: BottleResolution
  onScanNext?: () => void
  readOnly?: boolean
}

export function BottleConferencePanel({ bottle, onScanNext, readOnly = false }: Props) {
  const [mlInput, setMlInput] = useState(String(bottle.physical_ml))
  const [apc, setApc] = useState(bottle.apc_unit_available)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConferenceResult | null>(null)

  const observedMl = Number(mlInput.replace(',', '.'))
  const valid = mlInput.trim() !== '' && Number.isFinite(observedMl) && observedMl >= 0
  const diff = valid ? computeConferenceDiff(bottle.physical_ml, observedMl) : null

  async function confirm() {
    if (!valid || !diff) return
    setConfirming(true); setError('')
    try {
      setResult(await confirmBottleConference(bottle.bottle_id, observedMl, apc, bottle.updated_at))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar a conferência.')
    } finally {
      setConfirming(false)
    }
  }

  if (result) {
    const success = apcLabel(result.apc_unit_available)
    return (
      <div className="bottle-conference bottle-conference--success">
        <div className="bottle-success-icon"><Check size={28} /></div>
        <p className="bottle-success-title">CONFERÊNCIA REGISTRADA</p>
        <h1 className="bottle-conference-perfume">{bottle.perfume_name} · {bottle.brand_house ?? ''}</h1>
        <p className="bottle-conference-label">{bottle.bottle_label}</p>
        <div className="bottle-success-values">
          <strong>{result.status === 'empty' ? 'FRASCO VAZIO' : formatMl(result.physical_ml)}</strong>
          <span>APC {success.headline}</span>
        </div>
        <p className="bottle-success-when">Conferido agora.</p>
        {onScanNext && <button className="bottle-primary-action" onClick={onScanNext}>Ler próximo QR</button>}
      </div>
    )
  }

  return (
    <div className="bottle-conference">
      <p className="bottle-conference-eyebrow">{bottle.brand_house ?? 'MARCA NÃO INFORMADA'}</p>
      <h1 className="bottle-conference-perfume">{bottle.perfume_name}</h1>
      <p className="bottle-conference-label">{bottle.bottle_label} · {bottle.bottle_code}</p>

      <div className="bottle-system-value">
        <span>ESTOQUE ATUAL</span>
        <strong>{formatMl(bottle.physical_ml)}</strong>
      </div>

      <label className="bottle-ml-field">
        <span>QUANTO EXISTE FISICAMENTE AGORA?</span>
        <div className="bottle-ml-input-row">
          <input inputMode="decimal" value={mlInput} onChange={(event) => setMlInput(event.target.value)} aria-label="Quantidade em ml" disabled={readOnly} />
          <span>ml</span>
        </div>
      </label>

      <div className="bottle-apc-field">
        <span>APC</span>
        <div className="bottle-apc-options">
          <button type="button" className={apc ? 'active' : ''} onClick={() => setApc(true)} disabled={readOnly}>1 DE 1</button>
          <button type="button" className={!apc ? 'active' : ''} onClick={() => setApc(false)} disabled={readOnly}>0 DE 1</button>
        </div>
      </div>

      {readOnly && <p className="bottle-readonly-notice">Seu perfil só permite visualizar — conferências ficam com admin, manager ou operator.</p>}

      {diff && diff.changed && (
        <div className="bottle-diff-preview">
          <div><span>ESTAVA</span><strong>{formatMl(diff.before)}</strong></div>
          <div><span>CONFERIDO</span><strong>{formatMl(diff.after)}</strong></div>
          <div><span>DIFERENÇA</span><strong className={diff.delta < 0 ? 'negative' : 'positive'}>{formatDelta(diff.delta)}</strong></div>
        </div>
      )}
      {diff && diff.after === 0 && <p className="bottle-empty-notice"><Package size={14} /> Frasco vazio — o registro físico continua existindo.</p>}

      {error && <div className="bottle-conference-error">{error}</div>}

      {!readOnly && (
        <button className="bottle-primary-action" disabled={!valid || confirming} onClick={confirm}>
          {confirming ? 'Confirmando…' : diff?.changed ? `Confirmar ${formatMl(diff.after)}` : 'Confirmar conferência'}
        </button>
      )}
    </div>
  )
}
