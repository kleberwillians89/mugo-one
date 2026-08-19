import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ClipboardList, Printer, QrCode, Scissors } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton, StatusBadge } from '../ui'
import {
  InventoryBottle, TrackingPreview, fetchBottlesForItem, fetchTrackingPreview,
  finalizeTracking, generateBottle,
} from '../../lib/inventory-bottles'
import { apcLabel, computeTrackingReconciliation, formatMl } from '../../lib/bottle-scan'
import { BottleLabelPrint } from './BottleLabelPrint'
import { BottleSplitModal } from './BottleSplitModal'
import './BottleOnboardingModal.css'

function goToCount(itemId:string) {
  history.pushState({}, '', `/estoque/${itemId}/contagem`)
  dispatchEvent(new PopStateEvent('popstate'))
}

type Props = {
  itemId: string
  perfumeName: string
  close: () => void
  canManage: boolean
}

export function BottleOnboardingModal({ itemId, perfumeName, close, canManage }: Props) {
  const [preview, setPreview] = useState<TrackingPreview | null>(null)
  const [bottles, setBottles] = useState<InventoryBottle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [generating, setGenerating] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [printSelection, setPrintSelection] = useState<Set<string>>(new Set())
  const [printQueue, setPrintQueue] = useState<InventoryBottle[] | null>(null)
  const [splittingBottle, setSplittingBottle] = useState<InventoryBottle | null>(null)

  const load = () => {
    Promise.all([fetchTrackingPreview(itemId), fetchBottlesForItem(itemId)])
      .then(([previewResult, bottleRows]) => { setPreview(previewResult); setBottles(bottleRows); setError('') })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os frascos.'))
      .finally(() => setLoading(false))
  }
  const reload = () => { setLoading(true); load() }
  useEffect(load, [itemId])

  const reconciliation = useMemo(() => preview ? computeTrackingReconciliation(preview.system_ml, preview.identified_ml) : null, [preview])
  const activeBottles = useMemo(() => bottles.filter((b) => b.status !== 'retired'), [bottles])

  async function handleGenerate() {
    if (!newLabel.trim()) return
    setGenerating(true); setError('')
    try {
      await generateBottle(itemId, newLabel.trim())
      setNewLabel('')
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar esta identidade.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleFinalize() {
    setFinalizing(true); setError('')
    try {
      await finalizeTracking(itemId)
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível finalizar a identificação.')
    } finally {
      setFinalizing(false)
    }
  }

  function togglePrint(id: string) {
    setPrintSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function printOne(bottle: InventoryBottle) {
    setPrintQueue([bottle])
    requestAnimationFrame(() => window.print())
  }

  function printSelected() {
    const chosen = activeBottles.filter((bottle) => printSelection.has(bottle.id))
    if (chosen.length === 0) return
    setPrintQueue(chosen)
    requestAnimationFrame(() => window.print())
  }

  return (
    <Modal open onClose={close} size="lg" eyebrow="ESTOQUE · IDENTIDADE FÍSICA" title={`Frascos de ${perfumeName}`} footer={
      <>
        <SecondaryButton onClick={() => goToCount(itemId)} icon={<ClipboardList size={16} />}>Iniciar inventário por bip</SecondaryButton>
        <SecondaryButton onClick={close}>Fechar</SecondaryButton>
      </>
    }>
      {printQueue && <BottleLabelPrint bottles={printQueue} />}
      {splittingBottle && <BottleSplitModal bottle={splittingBottle} perfumeName={perfumeName} close={() => setSplittingBottle(null)} onDone={reload} />}

      {error && <div className="notice"><AlertTriangle size={16} /><span>{error}</span></div>}

      {loading ? <p>Carregando…</p> : preview && (
        <div className="bottle-onboarding">
          <div className="bottle-onboarding-status">
            <StatusBadge tone={preview.bottle_tracking_status === 'active' ? 'success' : preview.bottle_tracking_status === 'onboarding' ? 'warning' : 'neutral'}>
              {preview.bottle_tracking_status === 'active' ? 'IDENTIFICAÇÃO ATIVA' : preview.bottle_tracking_status === 'onboarding' ? 'IDENTIFICANDO' : 'NÃO IDENTIFICADO'}
            </StatusBadge>
            <div className="bottle-onboarding-totals">
              <div><span>ESTOQUE NO SISTEMA</span><strong>{formatMl(preview.system_ml)}</strong></div>
              <div><span>TOTAL IDENTIFICADO</span><strong>{formatMl(preview.identified_ml)}</strong></div>
            </div>
            {reconciliation && !reconciliation.reconciled && (
              <p className="bottle-onboarding-diff">DIFERENÇA: {reconciliation.diff > 0 ? '+' : ''}{formatMl(reconciliation.diff)} — ajuste um frasco ou o estoque antes de finalizar.</p>
            )}
            {reconciliation?.reconciled && activeBottles.length > 0 && <p className="bottle-onboarding-ok">✓ Conciliado</p>}
          </div>

          {activeBottles.length > 0 && (
            <ul className="bottle-onboarding-list">
              {activeBottles.map((bottle) => {
                const apc = apcLabel(bottle.apc_unit_available)
                return (
                  <li key={bottle.id}>
                    <label className="bottle-onboarding-checkbox">
                      <input type="checkbox" checked={printSelection.has(bottle.id)} onChange={() => togglePrint(bottle.id)} aria-label={`Selecionar ${bottle.bottle_label} para impressão`} />
                    </label>
                    <div className="bottle-onboarding-item-info">
                      <strong>{bottle.bottle_label}</strong>
                      <span>{bottle.bottle_code} · {formatMl(bottle.physical_ml)} · APC {apc.headline}</span>
                    </div>
                    <button className="bottle-onboarding-print-one" onClick={() => printOne(bottle)}><Printer size={14} /> Etiqueta</button>
                    {canManage && <button className="bottle-onboarding-print-one" onClick={() => setSplittingBottle(bottle)}><Scissors size={14} /> Fracionar</button>}
                  </li>
                )
              })}
            </ul>
          )}

          {canManage && (
            <div className="bottle-onboarding-actions">
              <div className="bottle-onboarding-generate">
                <input placeholder="Nome do frasco (ex.: Frasco 03)" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} />
                <PrimaryButton icon={<QrCode size={16} />} loading={generating} onClick={handleGenerate}>Gerar identidade</PrimaryButton>
              </div>
              <div className="bottle-onboarding-buttons">
                <SecondaryButton icon={<Printer size={16} />} onClick={printSelected} disabled={printSelection.size === 0}>Imprimir selecionadas ({printSelection.size})</SecondaryButton>
                <PrimaryButton icon={<Check size={16} />} disabled={!reconciliation?.reconciled || activeBottles.length === 0} loading={finalizing} onClick={handleFinalize}>Finalizar identificação</PrimaryButton>
              </div>
              <small className="bottle-onboarding-print-hint">Etiqueta é 30x10mm — na caixa de impressão, selecione "Tamanho real" (100%), nunca "Ajustar à página".</small>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
