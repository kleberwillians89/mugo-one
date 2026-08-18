import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'
import { QrScanDedup } from '../../lib/qr-scan-dedup'
import './QrCameraScanner.css'

type Props = { onScan: (value: string) => void; onClose?: () => void }

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

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      setActive(true)
      tick()
    }).catch(() => {
      setError('Não conseguimos acessar a câmera. Use a câmera normal do celular ou digite o código manualmente.')
    })
    function tick() {
      const video = videoRef.current, canvas = canvasRef.current
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const image = context.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(image.data, image.width, image.height)
          if (code?.data && dedupRef.current.shouldAccept(code.data, performance.now())) {
            playFeedback('valid')
            stopCamera()
            onScan(code.data)
            return
          }
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
      <p className="qr-scanner-hint"><Camera size={14} /> {active ? 'Aponte para o QR do frasco' : 'Abrindo câmera…'}</p>
    </div>
  )
}
