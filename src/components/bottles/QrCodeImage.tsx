import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Plain QR only — no logo overlay (briefing section 20: a logo is allowed
 * only once real scan-reliability testing confirms it, and this environment
 * has no way to test a physical print against a physical camera, so the
 * fallback rule applies: standard QR wins).
 */
export function QrCodeImage({ value, size = 176, alt = 'QR do frasco' }:{ value:string; size?:number; alt?:string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size })
      .then((url) => { if (!cancelled) setDataUrl(url) })
      .catch(() => { if (!cancelled) setDataUrl(null) })
    return () => { cancelled = true }
  }, [value, size])
  if (!dataUrl) return <div className="qr-code-placeholder" style={{ width: size, height: size }} aria-hidden="true" />
  return <img className="qr-code-image" src={dataUrl} width={size} height={size} alt={alt} />
}
