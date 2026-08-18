import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Boxes, Check, Download, Plus, TrendingUp, UserRound } from 'lucide-react'
import { integer } from '../lib/format'
import { PeriodFilter } from '../components/PeriodFilter'
import { PeriodValue } from '../lib/period'
import { exportCsv } from '../lib/csv'
import {
  InventoryRow, InventorySummary, OperationalInventoryRow,
  adjustInventory, createInventoryItem, fetchInventory, fetchOperationalInventory, inventoryPerfumes,
} from '../lib/records'
import { ReplenishmentSignal, fetchReplenishmentSignals, goToReplenishment } from '../lib/replenishment'
import { Metric } from '../components/shared/Metric'
import { EmptyState, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'
import './InventoryPage.css'

function stockState(balance: OperationalInventoryRow): { tone: 'success'|'warning'|'danger'; label: string } {
  if (balance.reconciliation_status === 'review_required') return { tone: 'warning', label: 'Precisa de conferência' }
  if (Number(balance.available_ml) <= 0) return { tone: 'danger', label: 'Esgotado' }
  if (Number(balance.available_ml) < Number(balance.minimum_ml)) return { tone: 'warning', label: 'Estoque baixo' }
  return { tone: 'success', label: 'Disponível' }
}

export function InventoryPage({period,setPeriod}:{period:PeriodValue;setPeriod:(value:PeriodValue)=>void}) {
  const [summary,setSummary]=useState<InventorySummary|null>(null),[rows,setRows]=useState<InventoryRow[]>([])
  const [operational,setOperational]=useState<OperationalInventoryRow[]>([])
  const [replenishment,setReplenishment]=useState<ReplenishmentSignal[]>([])
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showCreate,setShowCreate]=useState(false)
  const reload=()=>{setLoading(true);Promise.all([fetchInventory(period),fetchOperationalInventory(),fetchReplenishmentSignals().catch(()=>[])]).then(([result,balances,signals])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setReplenishment(signals);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))}
  useEffect(()=>{Promise.all([fetchInventory(period),fetchOperationalInventory(),fetchReplenishmentSignals().catch(()=>[])]).then(([result,balances,signals])=>{setSummary(result.summary);setRows(result.rows);setOperational(balances);setReplenishment(signals);setError('')}).catch((reason)=>setError(reason instanceof Error?reason.message:'Não foi possível carregar o estoque.')).finally(()=>setLoading(false))},[period])
  const replenishmentByItem=new Map(replenishment.map((signal)=>[signal.item_id,signal.status]))
  const adjust=async(row:InventoryRow,positive:boolean)=>{const raw=prompt(`${positive?'Entrada':'Ajuste negativo'} em ML para ${row.perfume}:`);if(!raw)return;const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return alert('Informe uma quantidade válida.');const reason=prompt('Motivo obrigatório:')?.trim();if(!reason)return;if(!positive&&!confirm(`Confirma retirar ${amount} ML de ${row.perfume}?`))return;try{await adjustInventory(row.item_id,positive?amount:-amount,reason);reload()}catch(reason){alert(reason instanceof Error?reason.message:'Não foi possível registrar o movimento.')}}

  return <div className="page">
    {showCreate&&<InventoryCreate close={()=>setShowCreate(false)} saved={()=>{setShowCreate(false);reload()}}/>}
    <PageHeader eyebrow="ACERVO RUAH" title="Estoque" description="Saldo em ML e movimentações integradas às novas vendas." actions={<>
      <PeriodFilter value={period} onApply={setPeriod}/>
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
          {key:'physical_ml',label:'Físico',render:(balance)=>`${Number(balance.physical_ml).toLocaleString('pt-BR')} ML`},
          {key:'reserved_ml',label:'Reservado',render:(balance)=>`${Number(balance.reserved_ml).toLocaleString('pt-BR')} ML`},
          {key:'shipping_ml',label:'Em preparação',render:(balance)=>`${Number(balance.shipping_ml).toLocaleString('pt-BR')} ML`},
          {key:'available_ml',label:'Disponível',render:(balance)=><strong className="stock-available">{Number(balance.available_ml).toLocaleString('pt-BR')} ML</strong>},
          {key:'minimum_ml',label:'Mínimo',render:(balance)=>`${Number(balance.minimum_ml).toLocaleString('pt-BR')} ML`},
          {key:'situacao',label:'Situação',render:(balance)=>{const state=stockState(balance);return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}},
          {key:'reposicao',label:'Reposição',render:(balance)=>{const status=replenishmentByItem.get(balance.item_id);return status==='critico'||status==='repor'?<StatusBadge tone={status==='critico'?'danger':'warning'}>REPOSIÇÃO</StatusBadge>:'—'}},
          {key:'actions',label:'Ações',render:(balance)=><div className="stock-actions"><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,true)}>Entrada</button><button onClick={()=>adjust(rows.find((row)=>row.item_id===balance.item_id)!,false)}>Ajustar</button>{stockState(balance).tone!=='success'&&<button onClick={()=>{history.pushState({},'',`/radar?q=${encodeURIComponent(balance.perfume)}`);dispatchEvent(new PopStateEvent('popstate'))}}>Buscar reposição</button>}</div>},
        ]}
      />
    </div>}
  </div>
}

function InventoryCreate({close,saved}:{close:()=>void;saved:()=>void}) {
  const [perfumes,setPerfumes]=useState<{id:string;full_name_raw:string}[]>([]),[perfumeId,setPerfumeId]=useState('')
  const [opening,setOpening]=useState(''),[minimum,setMinimum]=useState(''),[reference,setReference]=useState(format(new Date(),'yyyy-MM-dd')),[notes,setNotes]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  useEffect(()=>{inventoryPerfumes().then((data)=>setPerfumes(data))},[])
  const submit=async()=>{const openingMl=Number(opening.replace(',','.')),minimumMl=Number(minimum.replace(',','.'));if(!perfumeId||!Number.isFinite(openingMl)||openingMl<0||!Number.isFinite(minimumMl)||minimumMl<0||!reference)return setError('Preencha perfume, saldos e data corretamente.');setSaving(true);try{await createInventoryItem({perfumeId,openingMl,minimumMl,referenceDate:reference,notes});saved()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível cadastrar o estoque.')}finally{setSaving(false)}}
  return <Modal open onClose={close} eyebrow="CONTROLE DE ESTOQUE" title="Cadastrar perfume" footer={<>
      <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
      <PrimaryButton loading={saving} onClick={submit}>Cadastrar estoque</PrimaryButton>
    </>}>
    <div className="record-form"><div className="form-grid"><label className="field wide"><span>Perfume existente</span><select value={perfumeId} onChange={(event)=>setPerfumeId(event.target.value)}><option value="">Selecione…</option>{perfumes.map((perfume)=><option key={perfume.id} value={perfume.id}>{perfume.full_name_raw}</option>)}</select></label><label className="field"><span>Saldo inicial em ML</span><input inputMode="decimal" value={opening} onChange={(event)=>setOpening(event.target.value)}/></label><label className="field"><span>Limite mínimo em ML</span><input inputMode="decimal" value={minimum} onChange={(event)=>setMinimum(event.target.value)}/></label><label className="field"><span>Data de referência</span><input type="date" value={reference} onChange={(event)=>setReference(event.target.value)}/></label><label className="field wide"><span>Observação</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}</div>
  </Modal>
}
