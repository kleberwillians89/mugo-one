import { useEffect } from 'react'
import { BarcodeImage } from '../components/bottles/BarcodeImage'
import { QrCodeImage } from '../components/bottles/QrCodeImage'
import './PerfumePrintLabelPage.css'

// A regra global existe somente no documento isolado /print/perfume.
// Assim ela vence o @page A4 do bundle sem alterar outras impressões do CRM.
const PERFUME_LABEL_PAGE_STYLE = '@page { size: 70mm 30mm; margin: 0; }'

export function PerfumePrintLabelPage() {
  const params = new URLSearchParams(location.search)
  const perfume = params.get('perfume') ?? ''
  const brand = params.get('brand') ?? ''
  const code = params.get('codes') ?? ''

  useEffect(() => {
    document.title = 'Etiqueta de perfume — RUAH'
    if (!code) return
    const frame = requestAnimationFrame(() => window.print())
    const close = () => window.close()
    addEventListener('afterprint', close)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', close)
    }
  }, [code])

  if (!code) return <p>Nada para imprimir.</p>

  return (
    <>
      <style>{PERFUME_LABEL_PAGE_STYLE}</style>
      <div className="perfume-print-label">
        <strong>{perfume}</strong>
        {brand && <em>{brand}</em>}
        <div><BarcodeImage value={code} displayValue={false} height={72} width={1} margin={1} /></div>
        <code>{code}</code>
        <aside><QrCodeImage value={code} size={100} alt={`QR ${code}`} /></aside>
      </div>
    </>
  )
}
