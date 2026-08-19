import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Camera, Keyboard, ScanLine } from 'lucide-react'
import { authenticatedOrganization } from '../lib/records'
import { BottleResolution, SplitResolution, resolveBottleByCode, resolveBottleByToken, resolveSplitByCode } from '../lib/inventory-bottles'
import { formatMl, parseScannedValue } from '../lib/bottle-scan'
import { BottleConferencePanel } from '../components/bottles/BottleConferencePanel'
import { QrCameraScanner } from '../components/bottles/QrCameraScanner'
import { ScanFeedback } from '../components/bottles/ScanFeedback'
import { useKeyboardWedgeListener } from '../components/bottles/useKeyboardWedgeListener'
import './InventoryStationPage.css'

function goToInventory() {
  history.pushState({}, '', '/estoque')
  dispatchEvent(new PopStateEvent('popstate'))
}

const SPLIT_STATUS_LABEL: Record<SplitResolution['status'], string> = { available: 'Disponível', consumed: 'Usado', void: 'Anulado' }

type Mode = 'waiting' | 'camera' | 'resolving' | 'bottle' | 'split'

/**
 * /estoque/leitor — "Estação de Estoque": accepts camera QR, a USB/BT
 * barcode scanner (keyboard-wedge, always listening — no click required),
 * and manual entry simultaneously (briefing section 10/11/24).
 */
export function InventoryStationPage() {
  const [mode, setMode] = useState<Mode>('waiting')
  const [bottle, setBottle] = useState<BottleResolution | null>(null)
  const [split, setSplit] = useState<SplitResolution | null>(null)
  const [error, setError] = useState('')
  const [lastRaw, setLastRaw] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => { authenticatedOrganization().then((org) => setReadOnly(org.role === 'viewer')).catch(() => {}) }, [])

  const resolve = useCallback(async (raw: string) => {
    const parsed = parseScannedValue(raw)
    if (!parsed) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
    setMode('resolving'); setError('')
    try {
      if (parsed.kind === 'split') {
        const result = await resolveSplitByCode(parsed.value)
        if (!result) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
        setSplit(result); setMode('split'); return
      }
      const result = parsed.kind === 'token' ? await resolveBottleByToken(parsed.value) : await resolveBottleByCode(parsed.value)
      if (!result) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
      setBottle(result); setMode('bottle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este item.')
      setLastRaw(raw)
      setMode('waiting')
    }
  }, [])

  useKeyboardWedgeListener(resolve, mode === 'waiting')

  function backToWaiting() {
    setBottle(null); setSplit(null); setMode('waiting'); setManualCode(''); setError(''); setLastRaw('')
  }

  return (
    <div className="station-page">
      <header className="station-header">
        <button className="station-back" onClick={goToInventory}><ArrowLeft size={16} /> Voltar para o estoque</button>
        <span>RUAH</span>
        <strong>Estação de Estoque</strong>
      </header>

      <main className="station-main">
        {mode === 'bottle' && bottle ? (
          <div className="station-result">
            <ScanFeedback tone="success" title="✓ FRASCO RECONHECIDO">
              <span>{bottle.perfume_name}{bottle.brand_house ? ` · ${bottle.brand_house}` : ''}</span>
              <span>{bottle.bottle_code}</span>
            </ScanFeedback>
            <BottleConferencePanel bottle={bottle} onScanNext={backToWaiting} readOnly={readOnly} />
          </div>
        ) : mode === 'split' && split ? (
          <div className="station-result">
            <ScanFeedback tone="success" title="✓ SPLIT RECONHECIDO">
              <span>{split.perfume_name}{split.brand_house ? ` · ${split.brand_house}` : ''}</span>
              <span>{split.split_code}</span>
            </ScanFeedback>
            <dl className="station-split-facts">
              <div><dt>Quantidade</dt><dd>{formatMl(split.quantity_ml)}</dd></div>
              <div><dt>Status</dt><dd>{SPLIT_STATUS_LABEL[split.status]}</dd></div>
              <div><dt>Frasco fonte</dt><dd>{split.source_bottle_code}</dd></div>
            </dl>
            <button className="station-camera-btn" onClick={backToWaiting}>Ler próximo</button>
          </div>
        ) : mode === 'camera' ? (
          <QrCameraScanner onScan={resolve} onClose={() => setMode('waiting')} />
        ) : (
          <div className="station-waiting">
            <button className="station-camera-btn" onClick={() => setMode('camera')} disabled={mode === 'resolving'}>
              <Camera size={20} /> Ler com câmera
            </button>

            <div className="station-divider"><span>ou bipe com o scanner físico</span></div>

            <div className="station-listening">
              <ScanLine size={22} className={mode === 'resolving' ? '' : 'pulse'} />
              <p>{mode === 'resolving' ? 'Abrindo frasco…' : 'Scanner conectado? Bipe a etiqueta a qualquer momento.'}</p>
            </div>

            {error && (
              <ScanFeedback tone="error" title="✕ CÓDIGO NÃO RECONHECIDO">
                {lastRaw && <span>{lastRaw}</span>}
              </ScanFeedback>
            )}

            <form className="station-manual" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) resolve(manualCode) }}>
              <label><Keyboard size={14} /> Ou digite o código manualmente</label>
              <div className="station-manual-row">
                <input inputMode="text" placeholder="RUAH-F000001" value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
                <button type="submit" disabled={!manualCode.trim()}>Consultar</button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
