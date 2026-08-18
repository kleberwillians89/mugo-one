import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Camera, Keyboard, ScanLine } from 'lucide-react'
import { authenticatedOrganization } from '../lib/records'
import { BottleResolution, resolveBottleByCode, resolveBottleByToken } from '../lib/inventory-bottles'
import { parseScannedValue } from '../lib/bottle-scan'
import { BottleConferencePanel } from '../components/bottles/BottleConferencePanel'
import { QrCameraScanner } from '../components/bottles/QrCameraScanner'
import { useKeyboardWedgeListener } from '../components/bottles/useKeyboardWedgeListener'
import './InventoryStationPage.css'

function goToInventory() {
  history.pushState({}, '', '/estoque')
  dispatchEvent(new PopStateEvent('popstate'))
}

type Mode = 'waiting' | 'camera' | 'resolving' | 'bottle'

/**
 * /estoque/leitor — "Estação de Estoque": accepts camera QR, a USB/BT
 * barcode scanner (keyboard-wedge, always listening — no click required),
 * and manual entry simultaneously (briefing section 10/11/24).
 */
export function InventoryStationPage() {
  const [mode, setMode] = useState<Mode>('waiting')
  const [bottle, setBottle] = useState<BottleResolution | null>(null)
  const [error, setError] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => { authenticatedOrganization().then((org) => setReadOnly(org.role === 'viewer')).catch(() => {}) }, [])

  const resolve = useCallback(async (raw: string) => {
    const parsed = parseScannedValue(raw)
    if (!parsed) { setError('Não reconhecemos este frasco.'); setMode('waiting'); return }
    setMode('resolving'); setError('')
    try {
      const result = parsed.kind === 'token' ? await resolveBottleByToken(parsed.value) : await resolveBottleByCode(parsed.value)
      if (!result) { setError('Não reconhecemos este frasco.'); setMode('waiting'); return }
      setBottle(result); setMode('bottle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este frasco.')
      setMode('waiting')
    }
  }, [])

  useKeyboardWedgeListener(resolve, mode === 'waiting')

  function backToWaiting() {
    setBottle(null); setMode('waiting'); setManualCode(''); setError('')
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
          <BottleConferencePanel bottle={bottle} onScanNext={backToWaiting} readOnly={readOnly} />
        ) : mode === 'camera' ? (
          <QrCameraScanner onScan={resolve} onClose={() => setMode('waiting')} />
        ) : (
          <div className="station-waiting">
            <button className="station-camera-btn" onClick={() => setMode('camera')} disabled={mode === 'resolving'}>
              <Camera size={20} /> Ler QR com câmera
            </button>

            <div className="station-divider"><span>ou bipe o código de barras</span></div>

            <div className="station-listening">
              <ScanLine size={22} className={mode === 'resolving' ? '' : 'pulse'} />
              <p>{mode === 'resolving' ? 'Abrindo frasco…' : 'Aguardando leitura…'}</p>
            </div>

            {error && <div className="station-error">{error}</div>}

            <form className="station-manual" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) resolve(manualCode) }}>
              <label><Keyboard size={14} /> Digitar código manualmente</label>
              <div className="station-manual-row">
                <input inputMode="text" placeholder="F000185" value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
                <button type="submit" disabled={!manualCode.trim()}>Abrir</button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
