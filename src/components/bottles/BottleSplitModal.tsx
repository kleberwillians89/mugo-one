import { useState } from 'react'
import { AlertTriangle, Printer, QrCode, Scissors } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton } from '../ui'
import { InventoryBottle, InventorySplitUnit, splitBottle } from '../../lib/inventory-bottles'
import { computeSplitPreview } from '../../lib/split-units'
import { formatMl } from '../../lib/bottle-scan'
import { SplitLabelPrint } from './SplitLabelPrint'
import { PhysicalIdentityView } from './PhysicalIdentityView'
import './BottleSplitModal.css'

type Props = { bottle: InventoryBottle; perfumeName: string; close: () => void; onDone: () => void }

/**
 * Priority 0B — fracionar um frasco fonte em N vidros de split. Preview é
 * 100% local (computeSplitPreview, sem chamada de rede) até o clique
 * explícito em "Gerar splits"; só aí o RPC atômico grava (briefing: "No
 * database writes during preview... Require explicit confirmation").
 */
export function BottleSplitModal({ bottle, perfumeName, close, onDone }: Props) {
  const [quantityPerVial, setQuantityPerVial] = useState('')
  const [count, setCount] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<InventorySplitUnit[] | null>(null)
  const [printQueue, setPrintQueue] = useState<InventorySplitUnit[] | null>(null)
  const [identityUnit, setIdentityUnit] = useState<InventorySplitUnit | null>(null)

  const qty = Number(quantityPerVial.replace(',', '.'))
  const cnt = Number(count)
  const preview = computeSplitPreview(bottle.physical_ml, qty, cnt)

  async function handleCreate() {
    if (!preview.valid) return
    setCreating(true); setError('')
    try {
      const units = await splitBottle(bottle.id, qty, cnt)
      setCreated(units)
      onDone()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível fracionar este frasco.')
    } finally {
      setCreating(false)
    }
  }

  function printLabels() {
    if (!created) return
    setPrintQueue(created)
    requestAnimationFrame(() => window.print())
  }

  return <Modal open onClose={close} eyebrow="ESTOQUE · FRACIONAMENTO" title={`Fracionar ${bottle.bottle_label} — ${perfumeName}`} footer={
    created ? <>
      <SecondaryButton onClick={close}>Fechar</SecondaryButton>
      <PrimaryButton icon={<Printer size={16} />} onClick={printLabels}>Imprimir etiquetas</PrimaryButton>
    </> : <>
      <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
      <PrimaryButton icon={<Scissors size={16} />} loading={creating} disabled={!preview.valid} onClick={handleCreate}>Gerar {Number.isFinite(cnt) && cnt > 0 ? cnt : ''} splits</PrimaryButton>
    </>
  }>
    {printQueue && <SplitLabelPrint units={printQueue} perfumeName={perfumeName} />}
    {identityUnit && (
      <PhysicalIdentityView
        eyebrow={`SPLIT ${identityUnit.split_code}`}
        title={perfumeName}
        volumeLabel={formatMl(identityUnit.quantity_ml)}
        statusLabel={identityUnit.status === 'available' ? 'DISPONÍVEL' : identityUnit.status === 'consumed' ? 'USADO' : 'ANULADO'}
        statusTone={identityUnit.status === 'available' ? 'success' : 'neutral'}
        code={identityUnit.barcode_value}
        qrValue={identityUnit.barcode_value}
        onPrint={() => { setPrintQueue([identityUnit]); requestAnimationFrame(() => window.print()) }}
        onClose={() => setIdentityUnit(null)}
      />
    )}
    {error && <div className="notice"><AlertTriangle size={16} /><span>{error}</span></div>}

    {created ? <div className="bottle-split-result">
      <p>{created.length} split{created.length === 1 ? '' : 's'} gerado{created.length === 1 ? '' : 's'} a partir de {bottle.bottle_label}:</p>
      <ul className="bottle-split-list">
        {created.map((unit) => <li key={unit.id}><strong>{unit.split_code}</strong><span>{formatMl(unit.quantity_ml)}</span><button type="button" className="bottle-split-identity-btn" onClick={() => setIdentityUnit(unit)}><QrCode size={14} /> Identidade</button></li>)}
      </ul>
    </div> : <div className="bottle-split-form">
      <div className="bottle-split-source">
        <span>Disponível no frasco fonte</span>
        <strong>{formatMl(bottle.physical_ml)}</strong>
      </div>
      <div className="form-grid">
        <label className="field"><span>Quantidade por vidro (ml)</span><input inputMode="decimal" value={quantityPerVial} onChange={(event) => setQuantityPerVial(event.target.value)} placeholder="5" /></label>
        <label className="field"><span>Número de vidros</span><input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} placeholder="10" /></label>
      </div>
      <div className="bottle-split-preview">
        <div><span>Total fracionado</span><strong>{formatMl(preview.totalMl)}</strong></div>
        <div><span>Sobra no frasco fonte</span><strong className={preview.remainingMl < 0 ? 'bottle-split-negative' : ''}>{formatMl(preview.remainingMl)}</strong></div>
      </div>
      {preview.error && (quantityPerVial || count) && <p className="bottle-split-error">{preview.error}</p>}
    </div>}
  </Modal>
}
