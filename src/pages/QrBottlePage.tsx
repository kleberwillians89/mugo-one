import { useEffect, useState } from 'react'
import { LoaderCircle, PackageX, Radar } from 'lucide-react'
import { authenticatedOrganization } from '../lib/records'
import { BottleResolution, resolveBottleByToken } from '../lib/inventory-bottles'
import { parseScannedValue } from '../lib/bottle-scan'
import { BottleConferencePanel } from '../components/bottles/BottleConferencePanel'
import { QrCameraScanner } from '../components/bottles/QrCameraScanner'
import './QrBottlePage.css'

/**
 * Deep-link target of a printed QR (/q/:token). Rendered standalone, outside
 * the CRM sidebar/header shell — briefing: "deve parecer aplicativo". Auth
 * gating + return-to-this-path-after-login lives in Auth.tsx.
 */
export function QrBottlePage({ token }: { token: string }) {
  const [currentToken, setCurrentToken] = useState(token)
  const [bottle, setBottle] = useState<BottleResolution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [scanningNext, setScanningNext] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([resolveBottleByToken(currentToken), authenticatedOrganization()])
      .then(([result, org]) => {
        if (cancelled) return
        setReadOnly(org.role === 'viewer')
        if (!result) setError('Frasco não encontrado.')
        else { setBottle(result); setError('') }
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar este frasco.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentToken])

  function handleScanNext(raw: string) {
    const parsed = parseScannedValue(raw)
    if (parsed?.kind === 'token') {
      history.pushState({}, '', `/q/${parsed.value}`)
      setLoading(true); setBottle(null); setScanningNext(false)
      setCurrentToken(parsed.value)
    } else {
      setScanningNext(false)
      setError('Não reconhecemos este frasco.')
    }
  }

  return (
    <div className="qr-bottle-page">
      <header className="qr-bottle-header"><span>RUAH</span><strong>Conferência</strong></header>
      <main className="qr-bottle-main">
        {loading ? (
          <div className="qr-bottle-state"><LoaderCircle className="spin" size={28} /></div>
        ) : scanningNext ? (
          <QrCameraScanner onScan={handleScanNext} onClose={() => setScanningNext(false)} />
        ) : error ? (
          <div className="qr-bottle-state qr-bottle-state--error">
            <PackageX size={32} />
            <p>{error}</p>
            <button onClick={() => setScanningNext(true)}><Radar size={16} /> Ler outro QR</button>
          </div>
        ) : bottle ? (
          <BottleConferencePanel bottle={bottle} onScanNext={() => setScanningNext(true)} readOnly={readOnly} />
        ) : null}
      </main>
    </div>
  )
}
