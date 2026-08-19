import { useState } from 'react'
import { Camera, Check, Copy, Printer } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton, StatusBadge, Stepper } from '../ui'
import { QrCodeImage } from './QrCodeImage'
import { BarcodeImage } from './BarcodeImage'
import './PhysicalIdentityView.css'

function goToScanner() {
  history.pushState({}, '', '/estoque/leitor')
  dispatchEvent(new PopStateEvent('popstate'))
}

const GUIDE_STEPS = ['CONFIRA O VOLUME', 'IMPRIMA E COLE', 'FAÇA UM BIP', 'CONFIRME A IDENTIDADE']

type Props = {
  eyebrow: string
  title: string
  volumeLabel: string
  statusLabel: string
  statusTone: 'success' | 'warning' | 'neutral'
  /** Identidade legível/impressa no Code128 (ex.: RUAH-F000185 ou RUAH-S000185-001) — igual em texto e em barras, nunca trocada por estética (briefing seção 14). */
  code: string
  /**
   * Payload do QR exibido na tela. Para frasco: o deep link (/q/:token) já
   * resolvido pelo CRM. Para split (sem qr_token próprio — seção 3: "só
   * criar qr_token específico para split se houver motivo arquitetural
   * real", e não há): o próprio barcode_value, a mesma identidade estável
   * do Code128, sem inventar schema novo.
   */
  qrValue: string
  onPrint?: () => void
  onClose: () => void
  /** Ensina o fluxo (seção 13) — só na primeira tela, logo após gerar a identidade. */
  showGuide?: boolean
}

/**
 * "A identidade física do objeto na tela" (briefing seção 3/9): QR grande +
 * Code128 + fatos essenciais (volume/status), com ações de impressão,
 * leitura por câmera e cópia do código. Reaproveita QrCodeImage/BarcodeImage
 * (já existentes, usados noutros lugares do app) — não é um scanner novo,
 * só a exibição que faltava para o operador conseguir "ler o QR na tela".
 * Compartilhado entre frasco e split: a diferença entre os dois está só nos
 * valores passados pelo chamador, nunca em lógica duplicada aqui.
 */
export function PhysicalIdentityView({ eyebrow, title, volumeLabel, statusLabel, statusTone, code, qrValue, onPrint, onClose, showGuide }: Props) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      } else {
        const input = document.createElement('textarea')
        input.value = code
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        input.remove()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* melhor esforço — o código continua visível na tela para copiar manualmente */ }
  }

  return (
    <Modal open onClose={onClose} eyebrow={eyebrow} title={title} footer={
      <>
        <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
        {onPrint && <PrimaryButton icon={<Printer size={16} />} onClick={onPrint}>Imprimir etiqueta</PrimaryButton>}
      </>
    }>
      <div className="identity-view">
        {showGuide && <Stepper steps={GUIDE_STEPS} currentIndex={0} compact />}

        <div className="identity-view-facts">
          <div><span>VOLUME</span><strong>{volumeLabel}</strong></div>
          <div><span>STATUS</span><StatusBadge tone={statusTone}>{statusLabel}</StatusBadge></div>
        </div>

        <div className="identity-view-qr">
          <QrCodeImage value={qrValue} size={220} alt={`QR de ${code}`} />
        </div>
        <p className="identity-view-hint"><strong>QR Code</strong> — leia com a câmera do celular</p>

        <p className="identity-view-code">{code}</p>
        <div className="identity-view-barcode"><BarcodeImage value={code} /></div>
        <p className="identity-view-hint"><strong>Código de barras</strong> — leia com scanner físico</p>

        <div className="identity-view-actions">
          <SecondaryButton icon={<Camera size={16} />} onClick={goToScanner}>Ler com câmera</SecondaryButton>
          <SecondaryButton icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={copyCode}>{copied ? 'Copiado' : 'Copiar código'}</SecondaryButton>
        </div>

        {showGuide && <p className="identity-view-ready">PRONTO PARA OPERAÇÃO assim que a etiqueta for colada e o primeiro bip confirmar a identidade.</p>}
      </div>
    </Modal>
  )
}
