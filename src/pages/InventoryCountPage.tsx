import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, Check, Circle, Keyboard } from 'lucide-react'
import { TrackingPreview, TrackingPreviewBottle, fetchTrackingPreview, resolveBottleByCode, resolveBottleByToken } from '../lib/inventory-bottles'
import { parseScannedValue } from '../lib/bottle-scan'
import { QrCameraScanner } from '../components/bottles/QrCameraScanner'
import { useKeyboardWedgeListener } from '../components/bottles/useKeyboardWedgeListener'
import './InventoryCountPage.css'

function goToInventory() {
  history.pushState({}, '', '/estoque')
  dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * /estoque/:itemId/contagem — "Inventário por bip" (briefing section 17):
 * pure audit/checklist against the bottles already identified for this
 * perfume. Never writes to inventory_items/inventory_bottles — only reads.
 */
export function InventoryCountPage({ itemId }: { itemId: string }) {
  const [preview, setPreview] = useState<TrackingPreview | null>(null)
  const [found, setFound] = useState<Record<string, boolean>>({})
  const [camera, setCamera] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchTrackingPreview(itemId).then(setPreview).finally(() => setLoading(false)) }, [itemId])

  const expected = useMemo(() => preview?.bottles.filter((b) => b.status === 'active') ?? [], [preview])
  const foundCount = expected.filter((b) => found[b.id]).length
  const finished = expected.length > 0 && foundCount === expected.length

  const handleScan = useCallback(async (raw: string) => {
    setCamera(false)
    const parsed = parseScannedValue(raw)
    if (!parsed) { setNote('Não reconhecemos este frasco.'); return }
    try {
      const result = parsed.kind === 'token' ? await resolveBottleByToken(parsed.value) : await resolveBottleByCode(parsed.value)
      if (!result) { setNote('Não reconhecemos este frasco.'); return }
      if (result.inventory_item_id !== itemId) { setNote(`${result.bottle_label} pertence a outro perfume — não faz parte deste inventário.`); return }
      // Reler um frasco já conferido não pode contar duas vezes (briefing
      // seção 8) — found é um mapa por id (não uma lista), então o
      // contador já é naturalmente idempotente; falta só o aviso visual
      // distinto. Atualiza via updater funcional para nunca ler um
      // `found` desatualizado (handleScan é criado uma vez por itemId).
      let already = false
      setFound((prev) => {
        if (prev[result.bottle_id]) { already = true; return prev }
        return { ...prev, [result.bottle_id]: true }
      })
      setNote(already ? `⚠ FRASCO JÁ CONFERIDO — ${result.bottle_label}` : '')
      setManualCode('')
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : 'Não foi possível ler este frasco.')
    }
  }, [itemId])

  useKeyboardWedgeListener(handleScan, !camera)

  if (loading) return <div className="count-page"><div className="count-loading">Carregando…</div></div>
  if (!preview) return null

  return (
    <div className="count-page">
      <header className="count-header">
        <button className="count-back" onClick={goToInventory}><ArrowLeft size={16} /> Voltar para o estoque</button>
        <span>INVENTÁRIO POR BIP</span>
        <strong>{preview.perfume_name}</strong>
      </header>

      <main className="count-main">
        <div className="count-progress">
          <div><strong>{expected.length}</strong><span>esperados</span></div>
          <div><strong>{foundCount}</strong><span>conferidos</span></div>
          <div><strong>{expected.length - foundCount}</strong><span>faltando</span></div>
        </div>

        {!finished && (
          <>
            {camera ? (
              <QrCameraScanner onScan={handleScan} onClose={() => setCamera(false)} />
            ) : (
              <button className="count-camera-btn" onClick={() => setCamera(true)}><Camera size={18} /> Ler QR com câmera</button>
            )}
            {note && <div className="count-note">{note}</div>}
            <form className="count-manual" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) handleScan(manualCode) }}>
              <label><Keyboard size={13} /> Digitar código manualmente</label>
              <div className="count-manual-row">
                <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="F000185" />
                <button type="submit" disabled={!manualCode.trim()}>Ler</button>
              </div>
            </form>
          </>
        )}

        {finished && <div className="count-done">✓ Todos os frascos esperados foram conferidos.</div>}

        <ul className="count-list">
          {expected.map((bottle: TrackingPreviewBottle) => (
            <li key={bottle.id} className={found[bottle.id] ? 'found' : ''}>
              {found[bottle.id] ? <Check size={16} /> : <Circle size={16} />}
              <span>{bottle.bottle_code}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
