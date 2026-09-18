import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Boxes, Check, Download, Printer, RefreshCw, Search, TrendingUp, UserRound } from 'lucide-react'
import { brl, integer, slugify } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { exportCsv } from '../lib/csv'
import {
  InventoryRow, InventorySummary, OperationalInventoryRow,
  InventoryPreparationTotal, InventorySalesInsight, PerfumeCandidate, createCanonicalPerfume, fetchCanonicalPerfume, fetchInventory, fetchInventoryPreparationTotals, fetchInventorySaleBottleIdentities, fetchInventorySalesInsights, fetchOperationalInventory, findEquivalentPerfumes, perfumeCount, receiveInventoryPerfume, searchPerfumes, updateInventoryMinimum, updateInventorySalePrice,
} from '../lib/records'
import { looksLikeMlWithUnitSuffix, parseMlAmount } from '../lib/ml-input'
import { ReplenishmentSignal, fetchReplenishmentSignals, goToReplenishment } from '../lib/replenishment'
import { setPerfumeCost } from '../lib/cost-margin'
import { Metric } from '../components/shared/Metric'
import { EmptyState, EntityCombobox, EntityOption, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, useToast } from '../components/ui'
import { printPerfumeLabel } from '../lib/preparation'
import { downloadNodeAsPng } from '../lib/download-image'
import { INVENTORY_OFFER_IMAGE_PIXEL_RATIO, InventoryOfferImageCard, InventoryOfferImageData } from '../components/InventoryOfferImageCard'
import './InventoryPage.css'

function stockState(balance: OperationalInventoryRow): { tone: 'success'|'warning'|'danger'; label: string } {
  if (balance.reconciliation_status === 'review_required') return { tone: 'warning', label: 'Precisa de conferência' }
  if (Number(balance.available_ml) <= 0) return { tone: 'danger', label: 'Esgotado' }
  if (Number(balance.available_ml) < Number(balance.minimum_ml)) return { tone: 'warning', label: 'Estoque baixo' }
  return { tone: 'success', label: 'Disponível' }
}

function InventoryOfferDownload({offer,onDone}:{offer:InventoryOfferImageData;onDone:()=>void}){
  const{push}=useToast(),ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{let cancelled=false;const run=async()=>{if(!ref.current)return;try{await downloadNodeAsPng(ref.current,`disponivel-${slugify(offer.perfume)}-${new Date().toISOString().slice(0,10)}.png`,INVENTORY_OFFER_IMAGE_PIXEL_RATIO);if(!cancelled)push('Imagem do perfume baixada.',{tone:'success'})}catch(reason){if(!cancelled)push(reason instanceof Error?reason.message:'Não foi possível gerar a imagem.',{tone:'error'})}finally{if(!cancelled)onDone()}};void run();return()=>{cancelled=true}},[offer,onDone,push])
  return <div className="inventory-offer-image-offscreen" aria-hidden="true"><InventoryOfferImageCard ref={ref} offer={offer}/></div>
}

export function InventoryPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const {push}=useToast()
  const [summary,setSummary]=useState<InventorySummary|null>(null),[rows,setRows]=useState<InventoryRow[]>([])
  const [operational,setOperational]=useState<OperationalInventoryRow[]>([])
  const [preparationTotals,setPreparationTotals]=useState<InventoryPreparationTotal[]>([])
  const [salesInsights,setSalesInsights]=useState<InventorySalesInsight[]>([])
  const [saleBottles,setSaleBottles]=useState<{inventory_item_id:string;bottle_identifier:string|null}[]>([])
  const [replenishment,setReplenishment]=useState<ReplenishmentSignal[]>([])
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showCreate,setShowCreate]=useState(false),[downloadOffer,setDownloadOffer]=useState<InventoryOfferImageData|null>(null)
  const [query,setQuery]=useState('')
  const loadAll=()=>Promise.all([fetchInventory(period),fetchOperationalInventory(),fetchInventoryPreparationTotals(),fetchReplenishmentSignals().catch(()=>[]),fetchInventorySaleBottleIdentities(period),fetchInventorySalesInsights(period)] as const).then(([result,balances,preparing,signals,bottles,insights])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setPreparationTotals(preparing);setReplenishment(signals);setSaleBottles(bottles);setSalesInsights(insights);setError('')})
  const reload=()=>{setLoading(true);loadAll().catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))}
  useEffect(()=>{loadAll().catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))},[period])
  const replenishmentByItem=new Map(replenishment.map((signal)=>[signal.item_id,signal.status]))
  const preparingByPerfume=new Map(preparationTotals.map(row=>[row.perfume_id,Number(row.preparing_ml)]))
  const bottleLabelsByItem=new Map<string,string[]>();for(const row of saleBottles){if(!row.bottle_identifier)continue;const labels=bottleLabelsByItem.get(row.inventory_item_id)??[];if(!labels.includes(row.bottle_identifier))labels.push(row.bottle_identifier);bottleLabelsByItem.set(row.inventory_item_id,labels)}
  const insightByItem=new Map(salesInsights.map(row=>[row.item_id,row]))
  const periodItemIds=new Set(saleBottles.map(row=>row.inventory_item_id))
  const periodOperational=operational.filter(row=>periodItemIds.has(row.item_id))
  const visibleOperational=periodOperational.filter(row=>row.perfume.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))
  // Fase 8 do roadmap operacional ("Quanto custa?"): custo médio por ML,
  // mantido pela gestão — string vazia limpa o custo (volta a "não informado").
  const editCost=async(balance:OperationalInventoryRow)=>{const raw=prompt(`Custo por ML para ${balance.perfume} (R$, vazio para limpar):`,balance.average_cost_per_ml!==null?String(balance.average_cost_per_ml):'');if(raw===null)return;const trimmed=raw.trim();if(trimmed===''){try{await setPerfumeCost(balance.perfume_id,null);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o custo.')}return}const cost=Number(trimmed.replace(',','.'));if(!Number.isFinite(cost)||cost<0)return alert('Informe um custo válido.');try{await setPerfumeCost(balance.perfume_id,cost);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o custo.')}}
  const editMinimum=async(balance:OperationalInventoryRow)=>{const raw=prompt(`Reserva mínima em ML para ${balance.perfume}:`,String(balance.minimum_ml));if(raw===null)return;const minimum=Number(raw.replace(',','.'));if(!Number.isFinite(minimum)||minimum<0)return alert('Informe um mínimo válido.');try{await updateInventoryMinimum(balance.item_id,minimum);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o mínimo.')}}
  const editSalePrice=async(balance:OperationalInventoryRow,insight:InventorySalesInsight|undefined)=>{const raw=prompt(`Valor anunciado por ML para ${balance.perfume} (R$, vazio para limpar):`,insight?.sale_price_per_ml==null?'':String(insight.sale_price_per_ml).replace('.',','));if(raw===null)return;const trimmed=raw.trim(),price=trimmed===''?null:Number(trimmed.replace(',','.'));if(price!==null&&(!Number.isFinite(price)||price<0))return alert('Informe um valor por ML válido.');try{await updateInventorySalePrice(balance.item_id,price);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o valor por ML.')}}

  return <div className="page">
    {showCreate&&<InventoryCreate close={()=>setShowCreate(false)} saved={()=>{reload();push('Perfume recebido no estoque.',{tone:'success',duration:6000})}}/>}
    {downloadOffer&&<InventoryOfferDownload offer={downloadOffer} onDone={()=>setDownloadOffer(null)}/>}
    <PageHeader eyebrow="MUGÔ ONE" title="Estoque" description="Saldo automático calculado pelas vendas validadas. Para corrigir ML, corrija a venda de origem." actions={<>
      <PeriodFilter value={period} onApply={setPeriod}/>
      <SecondaryButton onClick={()=>{history.pushState({},'','/estoque/fracionamento');dispatchEvent(new PopStateEvent('popstate'))}}>Fracionamento</SecondaryButton>
      <SecondaryButton onClick={goToReplenishment}>Reposição inteligente</SecondaryButton>
      <PrimaryButton icon={<RefreshCw size={16}/>} onClick={()=>{reload();push('Estoque atualizado a partir das vendas.',{tone:'success'})}}>Atualizar vendas</PrimaryButton>
    </>}/>
    {summary&&<section className="metrics"><Metric label="Estoque físico" value={`${periodOperational.reduce((sum,row)=>sum+Number(row.physical_ml),0).toLocaleString('pt-BR')} ML`} detail={`${integer(periodOperational.length)} perfumes no período`} icon={Boxes}/><Metric label="Reservado para clientes" value={`${periodOperational.reduce((sum,row)=>sum+Number(row.reserved_ml)+Number(row.shipping_ml),0).toLocaleString('pt-BR')} ML`} detail="Pago e ainda guardado" icon={UserRound}/><Metric label="Disponível para venda" value={`${periodOperational.reduce((sum,row)=>sum+Number(row.available_ml),0).toLocaleString('pt-BR')} ML`} detail={`${periodOperational.filter((row)=>row.reconciliation_status==='review_required').length} para reconciliar`} icon={Check}/><Metric label="Consumo no período" value={`${Number(summary.consumed_ml).toLocaleString('pt-BR')} ML`} detail={`${integer(summary.movements)} movimentações`} icon={TrendingUp}/></section>}
    {error?<div className="notice"><AlertTriangle/><span>{error}</span></div>:loading?<div className="empty card"><h3>Carregando estoque…</h3></div>:rows.length===0?<EmptyState icon={Boxes} title="Estoque aguardando a primeira venda" description="Ao validar uma venda, o perfume será criado aqui e a sobra de ML ficará disponível automaticamente."/>:periodOperational.length===0?<EmptyState icon={Boxes} title="Nenhum perfume vendido neste período" description="Altere as datas para consultar os perfumes criados por outras vendas."/>:
    <section className="inventory-catalog">
      <div className="inventory-catalog-head">
        <div><strong>{integer(periodOperational.length)} perfumes no período</strong><span>Somente leitura: os ML nascem e são atualizados pelas vendas.</span></div>
        <label className="inventory-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar perfume…" aria-label="Buscar perfume no estoque"/></label>
        <SecondaryButton icon={<Download size={16}/>} onClick={()=>exportCsv('estoque.csv',periodOperational as unknown as Record<string,unknown>[])}>Exportar</SecondaryButton>
      </div>
      {visibleOperational.length===0?<div className="inventory-no-results"><Search/><strong>Nenhum perfume encontrado</strong><span>Tente buscar por outro nome.</span></div>:<div className="inventory-card-grid">{visibleOperational.map(balance=>{
        const state=stockState(balance),status=replenishmentByItem.get(balance.item_id),insight=insightByItem.get(balance.item_id),bottles=bottleLabelsByItem.get(balance.item_id)?.sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}))??[]
        return <article className={`inventory-perfume-card inventory-perfume-card--${state.tone}`} key={balance.item_id}>
          <header><div className="inventory-perfume-mark"><Boxes size={18}/></div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></header>
          <div className="inventory-perfume-name"><span>PERFUME</span><h3>{balance.perfume}</h3></div>
          {bottles.length>0&&<div className="inventory-bottle-identities"><span>FRASCOS DESTA VENDA</span><div>{bottles.map(label=><b key={label}>{label}</b>)}</div></div>}
          <div className="inventory-balance"><span>DISPONÍVEL PARA VENDA</span><strong>{Number(balance.available_ml).toLocaleString('pt-BR')} <small>ML</small></strong></div>
          <dl className="inventory-facts">
            <div><dt>Físico</dt><dd>{Number(balance.physical_ml).toLocaleString('pt-BR')} ML</dd></div>
            <div><dt>Reservado</dt><dd>{Number(balance.reserved_ml).toLocaleString('pt-BR')} ML</dd></div>
            <div><dt>Em preparo</dt><dd>{(preparingByPerfume.get(balance.perfume_id)??0).toLocaleString('pt-BR')} ML</dd></div>
            <div><dt>Em envio</dt><dd>{Number(balance.shipping_ml).toLocaleString('pt-BR')} ML</dd></div>
          </dl>
          <dl className="inventory-commercial-facts"><div><dt>Total vendido</dt><dd>{brl(Number(insight?.total_sold??0))}</dd></div><div><dt>Arrecadado</dt><dd>{brl(Number(insight?.total_collected??0))}</dd></div><div><dt>Compradores</dt><dd>{integer(Number(insight?.buyers_count??0))}</dd></div><div><dt>Valor por ML</dt><dd>{insight?.sale_price_per_ml==null?'Não informado':brl(Number(insight.sale_price_per_ml))}</dd></div></dl>
          <div className="inventory-secondary-facts"><span>Mínimo <strong>{Number(balance.minimum_ml).toLocaleString('pt-BR')} ML</strong></span><span>Custo/ML <strong>{balance.average_cost_per_ml===null?'Não informado':brl(balance.average_cost_per_ml)}</strong></span></div>
          {(status==='critico'||status==='repor')&&<div className="inventory-restock-alert"><AlertTriangle size={15}/> Reposição recomendada</div>}
          <footer className="stock-actions"><button onClick={()=>editSalePrice(balance,insight)}>Valor/ML</button><button disabled={Number(balance.available_ml)<=0} className="stock-action-highlight" onClick={()=>setDownloadOffer({perfume:balance.perfume,availableMl:Number(balance.available_ml),pricePerMl:insight?.sale_price_per_ml==null?null:Number(insight.sale_price_per_ml),bottles})}><Download size={13}/> Imagem</button><button onClick={()=>editCost(balance)}>Custo</button><button onClick={()=>editMinimum(balance)}>Mínimo</button>{state.tone!=='success'&&<button onClick={()=>{history.pushState({},'',`/radar?q=${encodeURIComponent(balance.perfume)}`);dispatchEvent(new PopStateEvent('popstate'))}}>Buscar reposição</button>}</footer>
        </article>
      })}</div>}
    </section>}
  </div>
}

function InventoryCreate({close,saved}:{close:()=>void;saved:()=>void}) {
  const [perfume,setPerfume]=useState<EntityOption|null>(null)
  const [mode,setMode]=useState<'existing'|'new'>('existing'),[name,setName]=useState(''),[brand,setBrand]=useState(''),[similar,setSimilar]=useState<PerfumeCandidate|null>(null),[empty,setEmpty]=useState(false),[candidates,setCandidates]=useState<PerfumeCandidate[]>([]),[canonical,setCanonical]=useState<PerfumeCandidate|null>(null),[success,setSuccess]=useState<(PerfumeCandidate&{operational_code:string})|null>(null),[receiptKey]=useState(()=>crypto.randomUUID())
  const [opening,setOpening]=useState(''),[minimum,setMinimum]=useState(''),[reference,setReference]=useState(format(new Date(),'yyyy-MM-dd')),[notes,setNotes]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const perfumeSearch=useCallback(async(term:string)=>{const rows=await searchPerfumes(term);setCandidates(rows);return rows.map(row=>({id:row.id,label:row.full_name_raw,description:[row.brand_house,row.operational_code].filter(Boolean).join(' · ')}))},[])
  useEffect(()=>{perfumeCount().then(count=>setEmpty(count===0)).catch(()=>{})},[])
  const startNew=useCallback((query='')=>{setMode('new');setPerfume(null);setCanonical(null);setName(query);setBrand('');setSimilar(null);setError('')},[])
  const chooseExisting=(candidate:PerfumeCandidate)=>{setPerfume({id:candidate.id,label:candidate.full_name_raw,description:[candidate.brand_house,candidate.operational_code].filter(Boolean).join(' · ')});setCanonical(candidate);setMode('existing');setSimilar(null);setError('')}
  const submit=async()=>{
    if(mode==='existing'&&!perfume)return setError('Selecione um perfume ou cadastre um novo.')
    if(mode==='new'&&(!name.trim()||!brand.trim()))return setError('Preencha nome do perfume e marca / casa.')
    if(!reference)return setError('Preencha a data de referência.')
    const openingMl=parseMlAmount(opening)
    if(openingMl===null||openingMl<=0)return setError(looksLikeMlWithUnitSuffix(opening)?'Informe apenas o valor numérico. Ex.: 100':'Informe quantos ml foram recebidos fisicamente.')
    const minimumMl=parseMlAmount(minimum)
    if(minimumMl===null||minimumMl<0)return setError(looksLikeMlWithUnitSuffix(minimum)?'Informe apenas o valor numérico. Ex.: 100':'Informe um limite mínimo válido em ml.')
    setSaving(true)
    try{
      let selected=canonical
      if(mode==='new'){
        const equivalents=await findEquivalentPerfumes(name)
        if(equivalents.length){setSimilar(equivalents[0]);setError('');return}
        const result=await createCanonicalPerfume({name,brand})
        selected=result.perfume
      }
      if(!selected)return setError('Selecione novamente o perfume recebido.')
      await receiveInventoryPerfume({perfumeId:selected.id,receivedMl:openingMl,minimumMl,referenceDate:reference,notes,idempotencyKey:receiptKey})
      const operational=await fetchCanonicalPerfume(selected.id)
      if(!/^RUAH-P\d{6}$/.test(operational.operational_code??''))throw new Error('A entrada foi registrada, mas a identidade operacional não foi retornada. Atualize a tela antes de repetir.')
      setSuccess(operational as PerfumeCandidate&{operational_code:string});saved()
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível cadastrar o estoque.')}finally{setSaving(false)}
  }
  return <Modal open onClose={close} eyebrow="CONTROLE DE ESTOQUE" title={success?'Perfume recebido':'Receber perfume'} footer={success?<><SecondaryButton onClick={close}>CONCLUIR</SecondaryButton><PrimaryButton icon={<Printer/>} onClick={()=>printPerfumeLabel(success)}>IMPRIMIR ETIQUETA</PrimaryButton></>:<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton loading={saving} onClick={submit}>CONFIRMAR RECEBIMENTO</PrimaryButton></>}>
    {success?<section className="inventory-perfume-success"><Check/><span>PERFUME RECEBIDO</span><h3>{success.full_name_raw}</h3>{success.brand_house&&<p>{success.brand_house}</p>}<strong>{opening} ML RECEBIDOS</strong><small>CÓDIGO OPERACIONAL</small><code>{success.operational_code}</code><ul><li>✓ Entrada física registrada</li><li>✓ Etiqueta pronta para impressão</li></ul></section>:<div className="record-form"><div className="inventory-create-mode" aria-live="polite"><strong>{mode==='new'?'NOVO PERFUME':'PERFUME EXISTENTE'}</strong>{mode==='new'&&<button type="button" onClick={()=>{setMode('existing');setSimilar(null)}}>Buscar existente</button>}</div>{mode==='existing'&&empty&&<div className="inventory-empty-perfumes"><strong>Nenhum perfume cadastrado ainda.</strong><button type="button" onClick={()=>startNew()}>CADASTRAR PRIMEIRO PERFUME</button></div>}<div className="form-grid">{mode==='existing'?<div className="field wide"><EntityCombobox label="Perfume" placeholder="Digite o nome do perfume ou da marca" value={perfume} onChange={option=>{setPerfume(option);setCanonical(option?candidates.find(row=>row.id===option.id)??null:null)}} search={perfumeSearch} noResultsLabel="Nenhum perfume encontrado." onCreate={startNew} createLabel={query=>`CADASTRAR “${query}”`}/>{canonical?.operational_code&&<div className="inventory-operational-identity"><span>Código operacional</span><code>{canonical.operational_code}</code><button type="button" onClick={()=>printPerfumeLabel(canonical)}>REIMPRIMIR ETIQUETA</button></div>}</div>:<><label className="field wide"><span>Nome do perfume</span><input autoFocus value={name} onChange={event=>{setName(event.target.value);setSimilar(null)}}/></label><label className="field wide"><span>Marca / Casa</span><input value={brand} onChange={event=>{setBrand(event.target.value);setSimilar(null)}}/></label>{similar&&<div className="inventory-similar wide"><strong>Encontramos um perfume parecido.</strong><span>{similar.full_name_raw}{similar.brand_house?` · ${similar.brand_house}`:''}{similar.operational_code?` · ${similar.operational_code}`:' · Ainda sem entrada física'}</span><button type="button" onClick={()=>chooseExisting(similar)}>USAR ESTE PERFUME</button></div>}</>}<label className="field"><span>ML recebidos</span><div className="field-ml-suffix"><input inputMode="decimal" placeholder="100" value={opening} onChange={(event)=>setOpening(event.target.value)} aria-label="ML recebidos"/><span>ml</span></div></label><label className="field"><span>Reserva mínima</span><div className="field-ml-suffix"><input inputMode="decimal" placeholder="5" value={minimum} onChange={(event)=>setMinimum(event.target.value)} aria-label="Reserva mínima em ml"/><span>ml</span></div></label><label className="field"><span>Data</span><input type="date" value={reference} onChange={(event)=>setReference(event.target.value)}/></label><label className="field wide"><span>Observação</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}</div>}
  </Modal>
}
