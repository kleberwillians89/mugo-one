import{useCallback,useEffect,useMemo,useState}from'react'
import{ChevronDown,ChevronRight,Printer,Scissors,Search}from'lucide-react'
import{fetchSplitStatusCards,fetchSplitStatusItems,fetchSplitStatusPerfumeSummary,setSplitStatus,setSplitStatusBulk,SplitStatusCards,SplitStatusFilter,SplitStatusFilters,SplitStatusItem,SplitStatusPerfumeGroup}from'../lib/records'
import{useHasPermission}from'../lib/PermissionsContext'
import{useToast}from'../components/ui'
import'./FaltaSplitarPage.css'

const QUICK_FILTERS:{value:SplitStatusFilter;label:string}[]=[{value:'not_split',label:'NÃO SPLITADOS'},{value:'split',label:'SPLITADOS'},{value:'split_today',label:'SPLITADOS HOJE'},{value:'all',label:'TODOS'}]
const shortDatePt=(iso:string|null)=>iso?new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR'):'—'

export function FaltaSplitarPage(){
  const canEdit=useHasPermission('sales.edit')
  const{push}=useToast()
  const[quickFilter,setQuickFilter]=useState<SplitStatusFilter>('not_split')
  const[filters,setFilters]=useState<SplitStatusFilters>({})
  const[search,setSearch]=useState('')
  const[cards,setCards]=useState<SplitStatusCards|null>(null)
  const[groups,setGroups]=useState<SplitStatusPerfumeGroup[]|null>(null)
  const[expanded,setExpanded]=useState<string|null>(null)
  const[itemsByPerfume,setItemsByPerfume]=useState<Record<string,SplitStatusItem[]>>({})
  const[loadingItem,setLoadingItem]=useState<string|null>(null)
  const[selected,setSelected]=useState<Set<string>>(new Set())
  const[bulkRunning,setBulkRunning]=useState(false)
  const[failedIds,setFailedIds]=useState<Record<string,string>>({})

  const effectiveFilters=useMemo<SplitStatusFilters>(()=>({...filters,search:search.trim()||undefined}),[filters,search])

  const loadSummary=useCallback(()=>{
    fetchSplitStatusCards().then(setCards).catch(()=>push('Não foi possível carregar os indicadores.',{tone:'error'}))
    fetchSplitStatusPerfumeSummary(quickFilter,effectiveFilters).then(setGroups).catch(()=>push('Não foi possível carregar os perfumes pendentes.',{tone:'error'}))
  },[quickFilter,effectiveFilters,push])
  useEffect(()=>{loadSummary()},[loadSummary])

  const loadItems=useCallback((perfumeId:string)=>{
    fetchSplitStatusItems({perfumeId,status:quickFilter,filters:effectiveFilters}).then(result=>setItemsByPerfume(current=>({...current,[perfumeId]:result.rows})))
      .catch(()=>push('Não foi possível carregar os itens deste perfume.',{tone:'error'}))
  },[quickFilter,effectiveFilters,push])

  const toggleGroup=(perfumeId:string)=>{
    if(expanded===perfumeId){setExpanded(null);return}
    setExpanded(perfumeId)
    if(!itemsByPerfume[perfumeId])loadItems(perfumeId)
  }

  const refreshAfterChange=(perfumeId:string)=>{loadSummary();loadItems(perfumeId)}

  const onStatusChange=async(item:SplitStatusItem,nextStatus:'not_split'|'split')=>{
    const previous=item.split_status
    setItemsByPerfume(current=>({...current,[item.perfume_id??'—']:(current[item.perfume_id??'—']??[]).map(row=>row.id===item.id?{...row,split_status:nextStatus}:row)}))
    setLoadingItem(item.id)
    try{
      await setSplitStatus(item.id,nextStatus,item.updated_at)
      setLoadingItem(null)
      push(nextStatus==='split'?'Marcado como SPLITADO.':'Marcado como NÃO SPLITADO.',{tone:'success'})
      refreshAfterChange(item.perfume_id??'—')
    }catch(error){
      setLoadingItem(null)
      setItemsByPerfume(current=>({...current,[item.perfume_id??'—']:(current[item.perfume_id??'—']??[]).map(row=>row.id===item.id?{...row,split_status:previous}:row)}))
      push(error instanceof Error?error.message:'Não foi possível salvar.',{tone:'error'})
    }
  }

  const toggleSelected=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})
  const toggleSelectAllVisible=(items:SplitStatusItem[])=>{
    const allSelected=items.every(item=>selected.has(item.id))
    setSelected(current=>{
      const next=new Set(current)
      for(const item of items){if(allSelected)next.delete(item.id);else next.add(item.id)}
      return next
    })
  }

  const runBulk=async(status:'not_split'|'split')=>{
    if(!selected.size)return
    setBulkRunning(true)
    setFailedIds({})
    try{
      const result=await setSplitStatusBulk([...selected],status)
      if(result.failed_count>0){
        push(`${result.updated_count} atualizados, ${result.failed_count} falhou.`,{tone:result.updated_count>0?'info':'error',duration:8000})
        setFailedIds(Object.fromEntries(result.failed.map(item=>[item.sale_id,item.reason])))
      }else{
        push(`${result.updated_count} atualizado${result.updated_count===1?'':'s'} com sucesso.`,{tone:'success'})
      }
      setSelected(new Set(result.failed.map(item=>item.sale_id)))
      loadSummary()
      if(expanded)loadItems(expanded)
    }catch(error){
      push(error instanceof Error?error.message:'Falha ao atualizar em massa.',{tone:'error'})
    }finally{
      setBulkRunning(false)
    }
  }

  const openPrint=()=>{
    if(!selected.size)return
    window.open(`/print/splits-do-dia?ids=${[...selected].join(',')}`,'_blank')
  }

  return <div className="falta-splitar-page">
    <header className="falta-splitar-header"><h1><Scissors size={20}/> Falta Splitar</h1><p>Controle operacional de split — independente de envio, pagamento e estoque.</p></header>

    <section className="falta-splitar-cards">
      <div><span>NÃO SPLITADOS</span><strong>{cards?.not_split??'—'}</strong></div>
      <div><span>SPLITADOS HOJE</span><strong>{cards?.split_today??'—'}</strong></div>
      <div><span>CLIENTES PENDENTES</span><strong>{cards?.clients_pending??'—'}</strong></div>
      <div><span>PERFUMES PENDENTES</span><strong>{cards?.perfumes_pending??'—'}</strong></div>
      <div><span>ML PENDENTES</span><strong>{cards?cards.ml_pending.toLocaleString('pt-BR'):'—'} ml</strong></div>
    </section>

    <section className="falta-splitar-filters">
      <div className="falta-splitar-quick-filters">{QUICK_FILTERS.map(item=><button key={item.value} className={quickFilter===item.value?'active':''} onClick={()=>setQuickFilter(item.value)}>{item.label}</button>)}</div>
      <div className="falta-splitar-search"><Search size={15}/><input placeholder="Buscar por cliente ou perfume" value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className="falta-splitar-extra-filters">
        <input placeholder="Cliente" value={filters.client??''} onChange={event=>setFilters(current=>({...current,client:event.target.value||undefined}))}/>
        <input placeholder="Marca" value={filters.brand??''} onChange={event=>setFilters(current=>({...current,brand:event.target.value||undefined}))}/>
        <input placeholder="Frasco" value={filters.bottle??''} onChange={event=>setFilters(current=>({...current,bottle:event.target.value||undefined}))}/>
        <input type="date" placeholder="Data da compra" value={filters.purchase_date??''} onChange={event=>setFilters(current=>({...current,purchase_date:event.target.value||undefined}))}/>
      </div>
    </section>

    {selected.size>0&&<section className="falta-splitar-bulk-bar">
      <span>{selected.size} selecionado{selected.size===1?'':'s'}</span>
      {canEdit&&<button disabled={bulkRunning} onClick={()=>runBulk('split')}>MARCAR COMO SPLITADO</button>}
      {canEdit&&<button disabled={bulkRunning} onClick={()=>runBulk('not_split')}>MARCAR COMO NÃO SPLITADO</button>}
      <button onClick={openPrint}><Printer size={14}/> IMPRIMIR SPLITS DO DIA</button>
      <button className="falta-splitar-bulk-clear" onClick={()=>setSelected(new Set())}>Limpar seleção</button>
    </section>}

    <section className="falta-splitar-groups">
      {groups===null&&<p className="falta-splitar-empty">Carregando…</p>}
      {groups!==null&&groups.length===0&&<p className="falta-splitar-empty">Nenhum item encontrado para este filtro.</p>}
      {groups?.map(group=>{
        const key=group.perfume_id??'—'
        const isOpen=expanded===key
        const items=itemsByPerfume[key]
        return <article className="falta-splitar-group" key={key}>
          <button className="falta-splitar-group-header" onClick={()=>toggleGroup(key)}>
            {isOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
            <div className="falta-splitar-group-title"><strong>{group.perfume_name}</strong>{group.brand_house&&<span> — {group.brand_house}</span>}</div>
            <div className="falta-splitar-group-stats"><span>{group.clients_count} cliente{group.clients_count===1?'':'s'}</span><span>{group.items_count} split{group.items_count===1?'':'s'}</span><span>{group.ml_total.toLocaleString('pt-BR')} ml</span></div>
          </button>
          {isOpen&&<div className="falta-splitar-group-detail">
            {!items&&<p className="falta-splitar-empty">Carregando itens…</p>}
            {items&&<table><thead><tr>
              <th><input type="checkbox" checked={items.length>0&&items.every(item=>selected.has(item.id))} onChange={()=>toggleSelectAllVisible(items)}/></th>
              <th>Cliente</th><th>Data da compra</th><th>Frasco</th><th>ML</th><th>Status</th>
            </tr></thead><tbody>{items.map(item=><tr key={item.id} className={failedIds[item.id]?'falta-splitar-row-failed':''}>
              <td><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSelected(item.id)}/></td>
              <td>{item.client_name}</td>
              <td>{shortDatePt(item.sale_date)}</td>
              <td>{item.bottle_identifier??'—'}</td>
              <td>{item.volume_ml??'—'}</td>
              <td>
                <select disabled={!canEdit||loadingItem===item.id} value={item.split_status} onChange={event=>onStatusChange(item,event.target.value as'not_split'|'split')}>
                  <option value="not_split">NÃO SPLITADO</option>
                  <option value="split">SPLITADO</option>
                </select>
                {failedIds[item.id]&&<small className="falta-splitar-row-error">{failedIds[item.id]}</small>}
              </td>
            </tr>)}</tbody></table>}
          </div>}
        </article>
      })}
    </section>
  </div>
}
