import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, Keyboard, ScanLine } from 'lucide-react'
import { authenticatedOrganization } from '../lib/records'
import { BottleResolution, SplitResolution, resolveBottleByCode, resolveBottleByToken, resolveSplitByCode } from '../lib/inventory-bottles'
import { formatMl, parseScannedValue } from '../lib/bottle-scan'
import {confirmInventoryStationPreparation,InventoryStationPreview,previewInventoryStation} from '../lib/preparation'
import { BottleConferencePanel } from '../components/bottles/BottleConferencePanel'
import { QrCameraScanner } from '../components/bottles/QrCameraScanner'
import { ScanFeedback } from '../components/bottles/ScanFeedback'
import { useKeyboardWedgeListener } from '../components/bottles/useKeyboardWedgeListener'
import './InventoryStationPage.css'

function goToInventory() {
  history.pushState({}, '', '/estoque')
  dispatchEvent(new PopStateEvent('popstate'))
}
function goToPreparation(perfumeId:string){history.pushState({},'',`/estoque/fracionamento?perfume=${encodeURIComponent(perfumeId)}`);dispatchEvent(new PopStateEvent('popstate'))}

const SPLIT_STATUS_LABEL: Record<SplitResolution['status'], string> = { available: 'Disponível', consumed: 'Usado', void: 'Anulado' }

type Mode = 'waiting' | 'camera' | 'resolving' | 'bottle' | 'split'|'perfume'

/**
 * /estoque/leitor — "Estação de Estoque": accepts camera QR, a USB/BT
 * barcode scanner (keyboard-wedge, always listening — no click required),
 * and manual entry simultaneously (briefing section 10/11/24).
 */
export function InventoryStationPage() {
  const [mode, setMode] = useState<Mode>('waiting')
  const [bottle, setBottle] = useState<BottleResolution | null>(null)
  const [split, setSplit] = useState<SplitResolution | null>(null)
  const [perfume,setPerfume]=useState<InventoryStationPreview|null>(null)
  const [selected,setSelected]=useState<Set<string>>(new Set())
  const [confirmingReceipt,setConfirmingReceipt]=useState(false)
  const [receiptConfirmed,setReceiptConfirmed]=useState(false)
  const idempotencyKey=useRef(crypto.randomUUID()),manualInput=useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [lastRaw, setLastRaw] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => { authenticatedOrganization().then((org) => setReadOnly(org.role === 'viewer')).catch(() => {}) }, [])

  const resolve = useCallback(async (raw: string) => {
    const parsed = parseScannedValue(raw)
    if (!parsed) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
    setMode('resolving'); setError('')
    try {
      if(parsed.kind==='perfume'){const result=await previewInventoryStation(parsed.value);if(!result){setError('Código não encontrado.');setMode('waiting');return}setPerfume(result);setSelected(new Set());idempotencyKey.current=crypto.randomUUID();setReceiptConfirmed(false);setMode('perfume');return}
      if (parsed.kind === 'split') {
        const result = await resolveSplitByCode(parsed.value)
        if (!result) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
        setSplit(result); setMode('split'); return
      }
      const result = parsed.kind === 'token' ? await resolveBottleByToken(parsed.value) : await resolveBottleByCode(parsed.value)
      if (!result) { setError('Não reconhecemos este frasco.'); setLastRaw(raw); setMode('waiting'); return }
      setBottle(result); setMode('bottle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este item.')
      setLastRaw(raw)
      setMode('waiting')
    }
  }, [])

  useKeyboardWedgeListener(resolve, mode === 'waiting')
  useEffect(()=>{const code=new URLSearchParams(location.search).get('codigo');if(!code)return;const timer=setTimeout(()=>void resolve(code),0);return()=>clearTimeout(timer)},[resolve])
  useEffect(()=>{if(mode==='waiting')requestAnimationFrame(()=>manualInput.current?.focus())},[mode])

  function backToWaiting() {
    setBottle(null); setSplit(null);setPerfume(null);setSelected(new Set());setReceiptConfirmed(false); setMode('waiting'); setManualCode(''); setError(''); setLastRaw('')
  }

  async function confirmReceipt(){
    if(!perfume||!selected.size||confirmingReceipt||readOnly)return
    setConfirmingReceipt(true);setError('')
    try{const items=perfume.items.filter(item=>selected.has(item.allocation_id)).map(item=>({allocation_id:item.allocation_id,quantity_ml:Number(item.remaining_ml),source_bottle_id:null}));await confirmInventoryStationPreparation(perfume.operational_code,items,idempotencyKey.current);setReceiptConfirmed(true)}
    catch(reason){const message=reason instanceof Error?reason.message:'';setError(message.includes('preparation_quantity_exceeded')?'Esta venda já foi preparada ou a quantidade não está mais disponível.':message.includes('insufficient')?'Saldo insuficiente para concluir a preparação.':message||'Não foi possível confirmar a preparação.')}
    finally{setConfirmingReceipt(false)}
  }

  return (
    <div className="station-page">
      <header className="station-header">
        <button className="station-back" onClick={goToInventory}><ArrowLeft size={16} /> Voltar para o estoque</button>
        <span>RUAH</span>
        <strong>Estação do Perfume</strong>
      </header>

      <main className="station-main">
        {mode==='perfume'&&perfume?<div className="station-result station-receipt"><ScanFeedback tone="success" title={receiptConfirmed?'✓ PREPARAÇÃO CONFIRMADA':'✓ PERFUME IDENTIFICADO'}><span>{perfume.perfume_name}{perfume.brand_house?` · ${perfume.brand_house}`:''}</span><span>{perfume.operational_code}</span></ScanFeedback>{receiptConfirmed?<div className="station-receipt-success"><CheckCircle2/><strong>Preparação confirmada</strong><span>As vendas selecionadas estão prontas para o próximo passo.</span></div>:<><dl className="station-split-facts"><div><dt>Estoque físico</dt><dd>{formatMl(perfume.physical_ml)}</dd></div><div><dt>Disponível</dt><dd>{formatMl(perfume.available_ml)}</dd></div></dl><section><h3>VENDAS AGUARDANDO PREPARAÇÃO</h3>{(['SPLIT','APC']as const).map(type=>{const items=perfume.items.filter(item=>(item.sale_type??'SPLIT')===type);return items.length?<div key={type} className="station-preparation-group"><strong>{type}</strong>{items.map(item=><label key={item.allocation_id}><input type="checkbox" checked={selected.has(item.allocation_id)} onChange={()=>setSelected(current=>{const next=new Set(current);if(next.has(item.allocation_id))next.delete(item.allocation_id);else next.add(item.allocation_id);return next})}/><span>{item.client_name} — {type==='APC'?'APC':formatMl(item.remaining_ml)}</span></label>)}</div>:null})}<strong>TOTAL SPLIT: {formatMl(perfume.items.filter(item=>selected.has(item.allocation_id)&&item.sale_type==='SPLIT').reduce((sum,item)=>sum+Number(item.remaining_ml),0))}</strong></section>{!perfume.items.length&&<p>Nenhuma venda aguarda preparação para este perfume.</p>}<p className="station-readonly-note">O bip apenas identificou o perfume. Nada foi alterado.</p>{error&&<ScanFeedback tone="error" title="NÃO FOI POSSÍVEL CONFIRMAR"><span>{error}</span></ScanFeedback>}<button className="station-camera-btn" disabled={!selected.size||readOnly||confirmingReceipt} onClick={confirmReceipt}>{confirmingReceipt?'CONFIRMANDO…':readOnly?'PERFIL SOMENTE LEITURA':'CONFIRMAR PREPARAÇÃO'}</button></>}<button className="station-secondary-btn" onClick={backToWaiting}>Ler próximo</button></div>:mode === 'bottle' && bottle ? (
          <div className="station-result">
            <ScanFeedback tone="success" title="✓ FRASCO RECONHECIDO">
              <span>{bottle.perfume_name}{bottle.brand_house ? ` · ${bottle.brand_house}` : ''}</span>
              <span>{bottle.bottle_code}</span>
            </ScanFeedback>
            <BottleConferencePanel bottle={bottle} onScanNext={backToWaiting} readOnly={readOnly} />
          </div>
        ) : mode === 'split' && split ? (
          <div className="station-result">
            <ScanFeedback tone="success" title="✓ SPLIT RECONHECIDO">
              <span>{split.perfume_name}{split.brand_house ? ` · ${split.brand_house}` : ''}</span>
              <span>{split.split_code}</span>
            </ScanFeedback>
            <dl className="station-split-facts">
              <div><dt>Quantidade</dt><dd>{formatMl(split.quantity_ml)}</dd></div>
              <div><dt>Status</dt><dd>{SPLIT_STATUS_LABEL[split.status]}</dd></div>
              <div><dt>Frasco fonte</dt><dd>{split.source_bottle_code}</dd></div>
            </dl>
            <button className="station-camera-btn" onClick={backToWaiting}>Ler próximo</button>
          </div>
        ) : mode === 'camera' ? (
          <QrCameraScanner onScan={resolve} onClose={() => setMode('waiting')} />
        ) : (
          <div className="station-waiting">
            <button className="station-camera-btn" onClick={() => setMode('camera')} disabled={mode === 'resolving'}>
              <Camera size={20} /> Ler com câmera
            </button>

            <div className="station-divider"><span>ou bipe com o scanner físico</span></div>

            <div className="station-listening">
              <ScanLine size={22} className={mode === 'resolving' ? '' : 'pulse'} />
              <p>{mode === 'resolving' ? 'Identificando…' : 'Bipe a etiqueta do perfume.'}</p>
            </div>

            {error && (
              <ScanFeedback tone="error" title="✕ CÓDIGO NÃO RECONHECIDO">
                {lastRaw && <span>{lastRaw}</span>}
              </ScanFeedback>
            )}

            <form className="station-manual" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) resolve(manualCode) }}>
              <label><Keyboard size={14} /> Ou digite o código manualmente</label>
              <div className="station-manual-row">
                <input ref={manualInput} autoFocus inputMode="text" placeholder="RUAH-P000123" value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
                <button type="submit" disabled={!manualCode.trim()}>Consultar</button>
              </div>
            </form>
          </div>
        )}
        {mode==='perfume'&&perfume&&!receiptConfirmed&&perfume.items.length===0&&<button className="station-camera-btn" onClick={()=>goToPreparation(perfume.perfume_id)}>ABRIR PREPARAÇÃO</button>}
      </main>
    </div>
  )
}
