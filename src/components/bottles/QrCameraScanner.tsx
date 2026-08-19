import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'
import { QrScanDedup } from '../../lib/qr-scan-dedup'
import './QrCameraScanner.css'

type Props = { onScan: (value: string) => void; onClose?: () => void }

/**
 * BarcodeDetector (nativa do navegador, sem dependência nova — briefing
 * seção 5: "não introduzir dependência pesada") decodifica QR E Code128 na
 * mesma chamada quando o navegador suporta os dois formatos. jsQR continua
 * como fallback OBRIGATÓRIO (não removido): a API não existe no Safari/iOS
 * até onde este ambiente consegue confirmar, e mesmo quando `BarcodeDetector`
 * existe, o suporte a 'code_128' especificamente varia por plataforma —
 * `getSupportedFormats()` é a única forma confiável de saber antes de tentar.
 */
type DetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type BarcodeDetectorCtor = { new (init: { formats: string[] }): DetectorLike; getSupportedFormats(): Promise<string[]> }

async function buildBarcodeDetector(): Promise<DetectorLike | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    const supported = await Ctor.getSupportedFormats()
    const formats = ['qr_code', 'code_128'].filter((format) => supported.includes(format))
    if (formats.length === 0) return null
    return new Ctor({ formats })
  } catch {
    return null
  }
}

/** Beep + vibration feedback (briefing section 29) — best-effort, never blocks the scan flow if unavailable. */
function playFeedback(kind: 'valid' | 'invalid') {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = kind === 'valid' ? 880 : 220
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.12)
  } catch { /* áudio indisponível — feedback visual/tátil continua funcionando */ }
  if (navigator.vibrate) navigator.vibrate(kind === 'valid' ? 60 : [40, 40, 40])
}

export function QrCameraScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const dedupRef = useRef(new QrScanDedup())
  const frameRef = useRef<number | undefined>(undefined)
  const streamRef = useRef<MediaStream | null>(null)
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const [error, setError] = useState(supported ? '' : 'Este navegador não permite abrir a câmera aqui. Use a câmera normal do celular para ler o QR.')
  const [active, setActive] = useState(false)
  const [dualFormat, setDualFormat] = useState(false)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    let detector: DetectorLike | null = null
    let detecting = false

    buildBarcodeDetector().then((result) => { if (!cancelled) { detector = result; setDualFormat(Boolean(result)) } })

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      setActive(true)
      tick()
    }).catch(() => {
      setError('Não conseguimos acessar a câmera. Use a câmera normal do celular ou digite o código manualmente.')
    })

    function accept(value: string) {
      if (!dedupRef.current.shouldAccept(value, performance.now())) return false
      playFeedback('valid')
      stopCamera()
      onScan(value)
      return true
    }

    function tick() {
      const video = videoRef.current, canvas = canvasRef.current
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          // BarcodeDetector primeiro (quando disponível): decodifica QR e
          // Code128 na mesma chamada — a câmera passa a ler as duas
          // etiquetas físicas, não só QR. `detecting` evita empilhar
          // chamadas assíncronas concorrentes enquanto uma ainda não voltou.
          if (detector && !detecting) {
            detecting = true
            detector.detect(canvas).then((results) => {
              detecting = false
              if (cancelled) return
              const value = results[0]?.rawValue
              if (value && accept(value)) return
              frameRef.current = requestAnimationFrame(tick)
            }).catch(() => {
              detecting = false
              if (!cancelled) frameRef.current = requestAnimationFrame(tick)
            })
            return
          }
          // Fallback jsQR (BarcodeDetector ausente ou sem formato usável
          // nesta plataforma) — só QR, comportamento original preservado.
          const image = context.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(image.data, image.width, image.height)
          if (code?.data && accept(code.data)) return
        }
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    function stopCamera() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
    return () => { cancelled = true; stopCamera() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="qr-scanner qr-scanner--error">
        <p>{error}</p>
        {onClose && <button onClick={onClose}>Fechar</button>}
      </div>
    )
  }

  return (
    <div className="qr-scanner">
      <div className="qr-scanner-frame">
        <video ref={videoRef} playsInline muted className="qr-scanner-video" />
        <div className="qr-scanner-reticle" aria-hidden="true" />
        {onClose && <button className="qr-scanner-close" aria-label="Fechar câmera" onClick={onClose}><X size={18} /></button>}
      </div>
      <p className="qr-scanner-hint"><Camera size={14} /> {active ? (dualFormat ? 'Aponte para o QR ou o código de barras' : 'Aponte para o QR do frasco') : 'Abrindo câmera…'}</p>
    </div>
  )
}
