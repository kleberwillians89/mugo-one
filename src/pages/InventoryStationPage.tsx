import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, Keyboard, ScanLine } from 'lucide-react'
import { authenticatedOrganization } from '../lib/records'
import { BottleResolution, SplitResolution, resolveBottleByCode, resolveBottleByToken, resolveSplitByCode } from '../lib/inventory-bottles'
import { formatMl, parseScannedValue } from '../lib/bottle-scan'
import {confirmInventoryStationPreparation,fetchPreparationBottles,InventoryStationPreview,PreparationBottle,PreparationCandidate,previewInventoryStation} from '../lib/preparation'
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
  const [bottles,setBottles]=useState<PreparationBottle[]>([])
  const [sourceByAllocation,setSourceByAllocation]=useState<Record<string,string>>({})
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
      if(parsed.kind==='perfume'){
        const result=await previewInventoryStation(parsed.value)
        if(!result){setError('Código não encontrado.');setMode('waiting');return}
        const needsBottle=result.items.some(item=>item.bottle_tracking_status==='active')
        const source=needsBottle?await fetchPreparationBottles(result.perfume_id):[]
        setPerfume(result)
        setBottles(source)
        setSourceByAllocation(Object.fromEntries(result.items.filter(item=>item.bottle_tracking_status==='active'&&source.length===1&&source[0].physical_ml>=Number(item.remaining_ml)).map(item=>[item.allocation_id,source[0].id])))
        setSelected(new Set())
        idempotencyKey.current=crypto.randomUUID()
        setReceiptConfirmed(false)
        setMode('perfume')
        return
      }
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
    setBottle(null); setSplit(null);setPerfume(null);setSelected(new Set());setBottles([]);setSourceByAllocation({});setReceiptConfirmed(false); setMode('waiting'); setManualCode(''); setError(''); setLastRaw('')
  }

  // Capacidade é sempre relativa ao que já foi comprometido pelos OUTROS
  // itens desta mesma sessão de leitura (bottle.physical_ml nunca é
  // decrementado pela preparação em si — só reflete o volume físico bruto
  // do frasco). O servidor (preparation_batch_create/_confirm) é quem
  // garante isto de fato contra todo o histórico já confirmado, inclusive
  // sob concorrência; isto aqui é só a UX reativa da sessão em tela.
  const bottleCommittedInSession=(bottleId:string,excludeAllocationId:string)=>(perfume?.items??[]).filter(item=>item.allocation_id!==excludeAllocationId&&sourceByAllocation[item.allocation_id]===bottleId).reduce((sum,item)=>sum+Number(item.remaining_ml),0)
  const bottleAvailableFor=(bottleId:string,allocationId:string)=>{const found=bottles.find(b=>b.id===bottleId);return found?found.physical_ml-bottleCommittedInSession(bottleId,allocationId):0}
  const isItemResolved=(item:PreparationCandidate)=>{if(item.bottle_tracking_status!=='active')return true;const chosen=sourceByAllocation[item.allocation_id];return Boolean(chosen)&&bottleAvailableFor(chosen,item.allocation_id)>=Number(item.remaining_ml)}
  const pendingAllocationIds=new Set((perfume?.items??[]).filter(item=>!isItemResolved(item)).map(item=>item.allocation_id))
  const pendingCount=pendingAllocationIds.size
  const selectedHasPendingLot=(perfume?.items??[]).some(item=>selected.has(item.allocation_id)&&pendingAllocationIds.has(item.allocation_id))
  const setSource=(allocationId:string,bottleId:string)=>setSourceByAllocation(current=>({...current,[allocationId]:bottleId}))

  async function confirmReceipt(){
    if(!perfume||!selected.size||confirmingReceipt||readOnly||selectedHasPendingLot)return
    setConfirmingReceipt(true);setError('')
    try{const items=perfume.items.filter(item=>selected.has(item.allocation_id)).map(item=>({allocation_id:item.allocation_id,quantity_ml:Number(item.remaining_ml),source_bottle_id:item.bottle_tracking_status==='active'?(sourceByAllocation[item.allocation_id]||null):null}));await confirmInventoryStationPreparation(perfume.operational_code,items,idempotencyKey.current);setReceiptConfirmed(true)}
    catch(reason){const message=reason instanceof Error?reason.message:'';setError(message.includes('preparation_quantity_exceeded')?'Esta venda já foi preparada ou a quantidade não está mais disponível.':message.includes('source_bottle_capacity_exceeded')?'O frasco escolhido não tem saldo suficiente para todas as vendas apontadas para ele — escolha outro frasco.':message.includes('insufficient')?'Saldo insuficiente para concluir a preparação.':message.includes('source_bottle_required')?'Selecione o frasco de origem para todas as vendas marcadas.':message.includes('invalid_source_bottle')?'O frasco selecionado não é mais válido — atualize a lista e escolha novamente.':message||'Não foi possível confirmar a preparação.')}
    finally{setConfirmingReceipt(false)}
  }

  function renderPreparationItem(item:PreparationCandidate){
    const type=item.sale_type==='APC'?'APC':'SPLIT'
    const needsBottle=item.bottle_tracking_status==='active'
    const isPending=pendingAllocationIds.has(item.allocation_id)
    const currentSourceId=sourceByAllocation[item.allocation_id]
    const chosen=bottles.find(b=>b.id===currentSourceId)
    // Só entram como opção frascos com saldo suficiente para ESTE item
    // (descontado o que outros itens desta sessão já reservaram do mesmo
    // frasco) — nunca deixa selecionar um frasco que não cobre o volume
    // pedido. O próprio frasco já escolhido continua listado (com o saldo
    // atualizado), mesmo que tenha ficado insuficiente por causa de outro
    // item, para o <select> nunca ficar com um valor fora da lista.
    const eligibleBottles=bottles.filter(b=>b.id===currentSourceId||bottleAvailableFor(b.id,item.allocation_id)>=Number(item.remaining_ml))
    return <div key={item.allocation_id} className={`station-prep-item${isPending?' station-prep-item--pending':''}`}>
      <label><input type="checkbox" checked={selected.has(item.allocation_id)} onChange={()=>setSelected(current=>{const next=new Set(current);if(next.has(item.allocation_id))next.delete(item.allocation_id);else next.add(item.allocation_id);return next})}/><span>{item.client_name} — {type==='APC'?'APC':formatMl(item.remaining_ml)}</span></label>
      {needsBottle&&(eligibleBottles.length?
        <div className="station-lot-resolver">
          <span className={`station-lot-badge${isPending?'':' station-lot-badge--resolved'}`}>{isPending?'PENDÊNCIA DE LOTE':`LOTE: ${chosen?.bottle_label??''}`}</span>
          <select aria-label={`Frasco de origem para ${item.client_name}`} value={currentSourceId??''} onChange={e=>setSource(item.allocation_id,e.target.value)}>
            <option value="">Selecionar frasco…</option>
            {eligibleBottles.map(b=><option key={b.id} value={b.id}>{b.bottle_label} · {b.barcode_value} · {formatMl(bottleAvailableFor(b.id,item.allocation_id))} disponíveis</option>)}
          </select>
        </div>
      :
        <div className="station-lot-empty">
          <span className="station-lot-badge station-lot-badge--danger">PENDÊNCIA DE LOTE</span>
          <p>Nenhum lote físico disponível para esta venda.</p>
          <button type="button" onClick={goToInventory}>ABRIR ESTOQUE</button>
        </div>
      )}
    </div>
  }

  return (
    <div className="station-page">
      <header className="station-header">
        <button className="station-back" onClick={goToInventory}><ArrowLeft size={16} /> Voltar para o estoque</button>
        <span>MUGÔ ONE</span>
        <strong>Estação do Perfume</strong>
      </header>

      <main className="station-main">
        {mode==='perfume'&&perfume?<div className="station-result station-receipt">
          <ScanFeedback tone="success" title={receiptConfirmed?'✓ PREPARAÇÃO CONFIRMADA':'✓ PERFUME IDENTIFICADO'}><span>{perfume.perfume_name}{perfume.brand_house?` · ${perfume.brand_house}`:''}</span><span>{perfume.operational_code}</span></ScanFeedback>
          {receiptConfirmed?<div className="station-receipt-success"><CheckCircle2/><strong>Preparação confirmada</strong><span>As vendas selecionadas estão prontas para o próximo passo.</span></div>:<>
            <dl className="station-split-facts">
              <div><dt>Estoque físico</dt><dd>{formatMl(perfume.physical_ml)}</dd></div>
              <div><dt>Disponível</dt><dd>{formatMl(perfume.available_ml)}</dd></div>
              <div><dt>Vendas aguardando preparação</dt><dd>{perfume.items.length}</dd></div>
              <div><dt>Volume total (SPLIT)</dt><dd>{formatMl(perfume.items.filter(item=>(item.sale_type??'SPLIT')==='SPLIT').reduce((sum,item)=>sum+Number(item.remaining_ml),0))}</dd></div>
              <div><dt>Pendências de lote</dt><dd>{pendingCount}</dd></div>
            </dl>
            {perfume.items.length>0&&(pendingCount>0?<p className="station-pending-banner">PENDÊNCIA DE LOTE — {pendingCount} venda{pendingCount===1?'':'s'} precisa{pendingCount===1?'':'m'} de frasco antes de confirmar</p>:<p className="station-ready-banner">PRONTO PARA PREPARAR</p>)}
            <section>
              <h3>VENDAS AGUARDANDO PREPARAÇÃO</h3>
              {(['SPLIT','APC']as const).map(type=>{const items=perfume.items.filter(item=>(item.sale_type??'SPLIT')===type);return items.length?<div key={type} className="station-preparation-group"><strong>{type}</strong>{items.map(renderPreparationItem)}</div>:null})}
              <strong>TOTAL SPLIT: {formatMl(perfume.items.filter(item=>selected.has(item.allocation_id)&&item.sale_type==='SPLIT').reduce((sum,item)=>sum+Number(item.remaining_ml),0))}</strong>
            </section>
            {!perfume.items.length&&<p>Nenhuma venda aguarda preparação para este perfume.</p>}
            <p className="station-readonly-note">O bip apenas identificou o perfume. Nada foi alterado.</p>
            {error&&<ScanFeedback tone="error" title="NÃO FOI POSSÍVEL CONFIRMAR"><span>{error}</span></ScanFeedback>}
            <button className="station-camera-btn" disabled={!selected.size||readOnly||confirmingReceipt||selectedHasPendingLot} onClick={confirmReceipt}>{confirmingReceipt?'CONFIRMANDO…':readOnly?'PERFIL SOMENTE LEITURA':selectedHasPendingLot?'RESOLVA A PENDÊNCIA DE LOTE':'CONFIRMAR PREPARAÇÃO'}</button>
          </>}
          <button className="station-secondary-btn" onClick={backToWaiting}>Ler próximo</button>
        </div>:mode === 'bottle' && bottle ? (
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
                <input ref={manualInput} autoFocus inputMode="text" placeholder="MUGO-P000123" value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
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
