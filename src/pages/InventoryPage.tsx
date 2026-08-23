import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Boxes, Check, Download, Plus, Printer, QrCode, TrendingUp, UserRound } from 'lucide-react'
import { brl, integer } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { exportCsv } from '../lib/csv'
import {
  InventoryRow, InventorySummary, OperationalInventoryRow,
  ExternalCustodyRow, PerfumeCandidate, adjustInventory, authenticatedOrganization, createCanonicalPerfume, fetchCanonicalPerfume, fetchExternalCustody, fetchInventory, fetchOperationalInventory, findEquivalentPerfumes, perfumeCount, receiveInventoryPerfume, searchPerfumes,
} from '../lib/records'
import { looksLikeMlWithUnitSuffix, parseMlAmount } from '../lib/ml-input'
import { ReplenishmentSignal, fetchReplenishmentSignals, goToReplenishment } from '../lib/replenishment'
import { setPerfumeCost } from '../lib/cost-margin'
import { Metric } from '../components/shared/Metric'
import { EmptyState, EntityCombobox, EntityOption, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table, useToast } from '../components/ui'
import { BottleOnboardingModal } from '../components/bottles/BottleOnboardingModal'
import { printPerfumeLabel } from '../lib/preparation'
import './InventoryPage.css'

function stockState(balance: OperationalInventoryRow): { tone: 'success'|'warning'|'danger'; label: string } {
  if (balance.reconciliation_status === 'review_required') return { tone: 'warning', label: 'Precisa de conferência' }
  if (Number(balance.available_ml) <= 0) return { tone: 'danger', label: 'Esgotado' }
  if (Number(balance.available_ml) < Number(balance.minimum_ml)) return { tone: 'warning', label: 'Estoque baixo' }
  return { tone: 'success', label: 'Disponível' }
}

export function InventoryPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const {push}=useToast()
  const [summary,setSummary]=useState<InventorySummary|null>(null),[rows,setRows]=useState<InventoryRow[]>([])
  const [operational,setOperational]=useState<OperationalInventoryRow[]>([])
  const [externalCustody,setExternalCustody]=useState<ExternalCustodyRow[]>([])
  const [replenishment,setReplenishment]=useState<ReplenishmentSignal[]>([])
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showCreate,setShowCreate]=useState(false)
  const [qrItem,setQrItem]=useState<OperationalInventoryRow|null>(null),[canManageBottles,setCanManageBottles]=useState(false)
  const reload=()=>{setLoading(true);Promise.all([fetchInventory(period),fetchOperationalInventory(),fetchExternalCustody(),fetchReplenishmentSignals().catch(()=>[])]).then(([result,balances,custody,signals])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setExternalCustody(custody);setReplenishment(signals);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))}
  useEffect(()=>{Promise.all([fetchInventory(period),fetchOperationalInventory(),fetchExternalCustody(),fetchReplenishmentSignals().catch(()=>[])]).then(([result,balances,custody,signals])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setExternalCustody(custody);setReplenishment(signals);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))},[period])
  useEffect(()=>{authenticatedOrganization().then((org)=>setCanManageBottles(org.role==='admin'||org.role==='manager')).catch(()=>{})},[])
  const replenishmentByItem=new Map(replenishment.map((signal)=>[signal.item_id,signal.status]))
  const custodyByPerfume=new Map(externalCustody.map(row=>[row.perfume_id,row]))
  const adjust=async(row:InventoryRow,positive:boolean)=>{const raw=prompt(`${positive?'Entrada':'Ajuste negativo'} em ML para ${row.perfume}:`);if(!raw)return;const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return alert('Informe uma quantidade válida.');const reason=prompt('Motivo obrigatório:')?.trim();if(!reason)return;if(!positive&&!confirm(`Confirma retirar ${amount} ML de ${row.perfume}?`))return;try{await adjustInventory(row.item_id,positive?amount:-amount,reason);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível registrar o movimento.')}}
  // Fase 8 do roadmap operacional ("Quanto custa?"): custo médio por ML,
  // mantido pela gestão — string vazia limpa o custo (volta a "não informado").
  const editCost=async(balance:OperationalInventoryRow)=>{const raw=prompt(`Custo por ML para ${balance.perfume} (R$, vazio para limpar):`,balance.average_cost_per_ml!==null?String(balance.average_cost_per_ml):'');if(raw===null)return;const trimmed=raw.trim();if(trimmed===''){try{await setPerfumeCost(balance.perfume_id,null);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o custo.')}return}const cost=Number(trimmed.replace(',','.'));if(!Number.isFinite(cost)||cost<0)return alert('Informe um custo válido.');try{await setPerfumeCost(balance.perfume_id,cost);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível atualizar o custo.')}}

  return <div className="page">
    {showCreate&&<InventoryCreate close={()=>setShowCreate(false)} saved={()=>{reload();push('Perfume cadastrado no estoque.',{tone:'success',duration:6000})}}/>}
    {qrItem&&<BottleOnboardingModal itemId={qrItem.item_id} perfumeName={qrItem.perfume} canManage={canManageBottles} close={()=>setQrItem(null)}/>}
    <PageHeader eyebrow="ACERVO RUAH" title="Estoque" description="Saldo em ML e movimentações integradas às novas vendas." actions={<>
      <PeriodFilter value={period} onApply={setPeriod}/>
      <SecondaryButton icon={<QrCode size={16}/>} onClick={()=>{history.pushState({},'','/estoque/leitor');dispatchEvent(new PopStateEvent('popstate'))}}>Estação de estoque</SecondaryButton>
      <SecondaryButton onClick={()=>{history.pushState({},'','/estoque/fracionamento');dispatchEvent(new PopStateEvent('popstate'))}}>Fracionamento</SecondaryButton>
      <SecondaryButton onClick={goToReplenishment}>Reposição inteligente</SecondaryButton>
      <PrimaryButton icon={<Plus size={16}/>} onClick={()=>setShowCreate(true)}>Cadastrar perfume</PrimaryButton>
    </>}/>
    {summary&&<section className="metrics"><Metric label="Estoque físico" value={`${operational.reduce((sum,row)=>sum+Number(row.physical_ml),0).toLocaleString('pt-BR')} ML`} detail={`${integer(summary.items)} perfumes`} icon={Boxes}/><Metric label="Reservado para clientes" value={`${operational.reduce((sum,row)=>sum+Number(row.reserved_ml)+Number(row.shipping_ml),0).toLocaleString('pt-BR')} ML`} detail="Pago e ainda guardado" icon={UserRound}/><Metric label="Disponível para venda" value={`${operational.reduce((sum,row)=>sum+Number(row.available_ml),0).toLocaleString('pt-BR')} ML`} detail={`${operational.filter((row)=>row.reconciliation_status==='review_required').length} para reconciliar`} icon={Check}/><Metric label="Consumo no período" value={`${Number(summary.consumed_ml).toLocaleString('pt-BR')} ML`} detail={`${integer(summary.movements)} movimentações`} icon={TrendingUp}/></section>}
    {error?<div className="notice"><AlertTriangle/><span>{error}</span></div>:loading?<div className="empty card"><h3>Carregando estoque…</h3></div>:rows.length===0?<EmptyState icon={Boxes} title="Estoque pronto para começar" description="Cadastre o saldo físico inicial de um perfume." action={{label:'Cadastrar primeiro perfume',onClick:()=>setShowCreate(true)}}/>:
    <div className="card clients-table"><div className="clients-caption"><strong>{integer(rows.length)} perfumes controlados</strong><SecondaryButton icon={<Download size={16}/>} onClick={()=>exportCsv('estoque-ruah.csv',operational as unknown as Record<string,unknown>[])}>Exportar</SecondaryButton></div>
      <Table
        rowKey={(balance)=>balance.item_id}
        rows={operational}
        columns={[
          {key:'perfume',label:'Perfume',render:(balance)=><strong>{balance.perfume}</strong>},
          {key:'physical_ml',label:'Físico',hideOnMobile:true,render:(balance)=>`${Number(balance.physical_ml).toLocaleString('pt-BR')} ML`},
          {key:'reserved_ml',label:'Reservado',render:(balance)=>`${Number(balance.reserved_ml).toLocaleString('pt-BR')} ML`},
          {key:'shipping_ml',label:'Em preparação',render:(balance)=>`${Number(balance.shipping_ml).toLocaleString('pt-BR')} ML`},
          {key:'external_custody',label:'Custódia da cliente',hideOnMobile:true,render:(balance)=>{const custody=custodyByPerfume.get(balance.perfume_id);const reserved=Number(custody?.reserved_ml??0),shipping=Number(custody?.shipping_ml??0);return reserved+shipping?`${(reserved+shipping).toLocaleString('pt-BR')} ML (${shipping.toLocaleString('pt-BR')} em envio)`:'—'}},
          {key:'available_ml',label:'Disponível',render:(balance)=><strong className="stock-available">{Number(balance.available_ml).toLocaleString('pt-BR')} ML</strong>},
          {key:'minimum_ml',label:'Mínimo',hideOnMobile:true,render:(balance)=>`${Number(balance.minimum_ml).toLocaleString('pt-BR')} ML`},
          {key:'average_cost_per_ml',label:'Custo/ML',hideOnMobile:true,render:(balance)=>balance.average_cost_per_ml===null?'—':brl(balance.average_cost_per_ml)},
          {key:'situacao',label:'Situação',render:(balance)=>{const state=stockState(balance);return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}},
          {key:'reposicao',label:'Reposição',render:(balance)=>{const status=replenishmentByItem.get(balance.item_id);return status==='critico'||status==='repor'?<StatusBadge tone={status==='critico'?'danger':'warning'}>REPOSIÇÃO</StatusBadge>:'—'}},
          {key:'actions',label:'Ações',render:(balance)=><div className="stock-actions"><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,true)}>Entrada</button><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,false)}>Ajustar</button><button onClick={()=>editCost(balance)}>Custo</button>{stockState(balance).tone!=='success'&&<button onClick={()=>{history.pushState({},'',`/radar?q=${encodeURIComponent(balance.perfume)}`);dispatchEvent(new PopStateEvent('popstate'))}}>Buscar reposição</button>}<button onClick={()=>setQrItem(balance)}><QrCode size={13}/> QR</button></div>},
        ]}
      />
    </div>}
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
  return <Modal open onClose={close} eyebrow="CONTROLE DE ESTOQUE" title={success?'Perfume cadastrado':'Cadastrar perfume no estoque'} footer={success?<><SecondaryButton onClick={close}>CONCLUIR</SecondaryButton><PrimaryButton icon={<Printer/>} onClick={()=>printPerfumeLabel(success)}>IMPRIMIR ETIQUETA</PrimaryButton></>:<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton loading={saving} onClick={submit}>CADASTRAR PERFUME NO ESTOQUE</PrimaryButton></>}>
    {success?<section className="inventory-perfume-success"><Check/><span>PERFUME CADASTRADO</span><h3>{success.full_name_raw}</h3>{success.brand_house&&<p>{success.brand_house}</p>}<small>CÓDIGO OPERACIONAL</small><code>{success.operational_code}</code><ul><li>✓ Código operacional criado</li><li>✓ Etiqueta pronta para impressão</li></ul></section>:<div className="record-form"><div className="inventory-create-mode" aria-live="polite"><strong>{mode==='new'?'NOVO PERFUME':'PERFUME EXISTENTE'}</strong>{mode==='new'&&<button type="button" onClick={()=>{setMode('existing');setSimilar(null)}}>Buscar existente</button>}</div>{mode==='existing'&&empty&&<div className="inventory-empty-perfumes"><strong>Nenhum perfume cadastrado ainda.</strong><button type="button" onClick={()=>startNew()}>CADASTRAR PRIMEIRO PERFUME</button></div>}<div className="form-grid">{mode==='existing'?<div className="field wide"><EntityCombobox label="Buscar perfume" placeholder="Digite o nome do perfume ou da marca" value={perfume} onChange={option=>{setPerfume(option);setCanonical(option?candidates.find(row=>row.id===option.id)??null:null)}} search={perfumeSearch} noResultsLabel="Nenhum perfume encontrado." onCreate={startNew} createLabel={query=>`CADASTRAR “${query}”`}/>{canonical?.operational_code&&<div className="inventory-operational-identity"><span>Código operacional</span><code>{canonical.operational_code}</code><button type="button" onClick={()=>printPerfumeLabel(canonical)}>REIMPRIMIR ETIQUETA</button></div>}</div>:<><label className="field wide"><span>Nome do perfume</span><input autoFocus value={name} onChange={event=>{setName(event.target.value);setSimilar(null)}}/></label><label className="field wide"><span>Marca / Casa</span><input value={brand} onChange={event=>{setBrand(event.target.value);setSimilar(null)}}/></label>{similar&&<div className="inventory-similar wide"><strong>Encontramos um perfume parecido.</strong><span>{similar.full_name_raw}{similar.brand_house?` · ${similar.brand_house}`:''}{similar.operational_code?` · ${similar.operational_code}`:' · Ainda sem entrada física'}</span><button type="button" onClick={()=>chooseExisting(similar)}>USAR ESTE PERFUME</button></div>}</>}<label className="field"><span>Volume físico</span><div className="field-ml-suffix"><input inputMode="decimal" placeholder="100" value={opening} onChange={(event)=>setOpening(event.target.value)} aria-label="Volume físico em ml"/><span>ml</span></div></label><label className="field"><span>Reserva mínima</span><div className="field-ml-suffix"><input inputMode="decimal" placeholder="5" value={minimum} onChange={(event)=>setMinimum(event.target.value)} aria-label="Reserva mínima em ml"/><span>ml</span></div></label><label className="field"><span>Data de referência</span><input type="date" value={reference} onChange={(event)=>setReference(event.target.value)}/></label><label className="field wide"><span>Observação</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}</div>}
  </Modal>
}
