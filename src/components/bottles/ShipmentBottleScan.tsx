import { useState } from 'react'
import { QrCode } from 'lucide-react'
import { BottleScanResult } from '../../lib/records'
import { describeBottleScanResult } from '../../lib/shipment-bottle-scan'
import { QrCameraScanner } from './QrCameraScanner'
import { useKeyboardWedgeListener } from './useKeyboardWedgeListener'
import './ShipmentBottleScan.css'

type BottleInfo = { bottle_code: string; bottle_label: string; physical_ml: number } | null

/**
 * Roadmap Fase 1 — "Qual frasco devo pegar? Bipei o frasco correto?" Reuses
 * the same camera/keyboard-wedge/manual primitives built for the QR feature
 * (Estação de Estoque) — no parallel scanning implementation. Purely
 * additive: rendered by the caller only for perfumes that opted into bottle
 * tracking; every other shipment item is untouched.
 */
export function ShipmentBottleScan({ bottleId, bottle, onScan }: { bottleId: string | null; bottle: BottleInfo; onScan: (rawValue: string) => Promise<BottleScanResult> }) {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  async function handleRaw(raw: string) {
    if (busy) return
    setBusy(true)
    try {
      const result = await onScan(raw)
      const described = describeBottleScanResult(result)
      setFeedback(described)
      if (described.tone === 'success') { setOpen(false); setManual('') } else setAttempt((n) => n + 1)
    } catch (reason) {
      setFeedback({ tone: 'error', message: reason instanceof Error ? reason.message : 'Não foi possível vincular este frasco.' })
      setAttempt((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  useKeyboardWedgeListener(handleRaw, open)

  if (bottleId && bottle) {
    return <div className="bottle-scan-chip"><QrCode size={12} /> {bottle.bottle_label} · {bottle.bottle_code}</div>
  }

  if (!open) {
    return <button type="button" className="bottle-scan-trigger" onClick={() => { setOpen(true); setFeedback(null) }}><QrCode size={13} /> Bipar frasco</button>
  }

  return (
    <div className="bottle-scan-panel">
      {feedback && <p className={`bottle-scan-feedback bottle-scan-feedback--${feedback.tone}`}>{feedback.message}</p>}
      <QrCameraScanner key={attempt} onScan={handleRaw} onClose={() => setOpen(false)} />
      <form className="bottle-scan-manual" onSubmit={(event) => { event.preventDefault(); if (manual.trim()) handleRaw(manual) }}>
        <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="F000185" disabled={busy} aria-label="Código do frasco" />
        <button type="submit" disabled={busy || !manual.trim()}>Abrir</button>
      </form>
      <button type="button" className="bottle-scan-cancel" onClick={() => setOpen(false)}>Cancelar</button>
    </div>
  )
}
