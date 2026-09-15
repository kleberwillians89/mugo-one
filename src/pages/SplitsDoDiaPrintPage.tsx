import{useEffect,useMemo,useState}from'react'
import{ArrowLeft,Printer}from'lucide-react'
import{fetchSplitStatusItems,SplitStatusItem}from'../lib/records'
import{groupSplitItemsByClient,groupSplitItemsByPerfume,splitPrintSummary}from'../lib/split-status-print'
import'./SplitsDoDiaPrintPage.css'

const PAGE_STYLE='@page { size: A4 portrait; margin: 12mm 14mm; }'
const today=()=>new Date().toLocaleDateString('pt-BR')

export function SplitsDoDiaPrintPage(){
  const ids=useMemo(()=>(new URLSearchParams(location.search).get('ids')??'').split(',').filter(Boolean),[])
  const[items,setItems]=useState<SplitStatusItem[]|null>(null),[fetchError,setFetchError]=useState('')
  useEffect(()=>{
    if(!ids.length)return
    fetchSplitStatusItems({saleIds:ids,pageSize:500}).then(result=>setItems(result.rows)).catch(()=>setFetchError('Não foi possível carregar os itens selecionados.'))
  },[ids])
  const error=ids.length?fetchError:'Nenhum item selecionado para impressão.'
  const perfumeGroups=useMemo(()=>items?groupSplitItemsByPerfume(items):[],[items])
  const groups=useMemo(()=>items?groupSplitItemsByClient(items):[],[items])
  const summary=useMemo(()=>splitPrintSummary(items??[],perfumeGroups),[items,perfumeGroups])

  if(error)return <main className="splits-document-state"><p>{error}</p><button onClick={()=>history.back()}>Voltar</button></main>
  if(!items)return <main className="splits-document-state"><p>Preparando separação do dia…</p></main>
  if(!items.length)return <main className="splits-document-state"><p>Nenhum item da seleção foi encontrado. Volte e gere a folha novamente.</p><button onClick={()=>history.back()}>Voltar</button></main>
  return <main className="splits-document-page"><style>{PAGE_STYLE}</style>
    <nav className="splits-document-actions"><button onClick={()=>history.back()}><ArrowLeft/> VOLTAR</button><button onClick={()=>window.print()}><Printer/> IMPRIMIR SEPARAÇÃO</button></nav>
    <article className="splits-document">
      <header className="splits-document-header"><div className="splits-document-brand"><strong>RUAH</strong><span>PARFUMS</span></div><div><span>DOCUMENTO OPERACIONAL</span><h1>SEPARAÇÃO DO DIA</h1><span className="splits-document-date">{today()}</span></div></header>
      <section className="splits-document-summary"><dl>
        <div><dt>Perfumes diferentes</dt><dd>{summary.perfumes}</dd></div>
        <div><dt>Itens da lista</dt><dd>{summary.splits}</dd></div>
        <div><dt>Total de clientes</dt><dd>{summary.clients}</dd></div>
        <div><dt>Total de ml</dt><dd>{summary.ml_total.toLocaleString('pt-BR')} ml</dd></div>
      </dl></section>
      {groups.map(group=>
        <section className="splits-document-group" key={group.key}>
          <h2>{group.client_name}{group.client_number!=null&&<span> — CLIENTE Nº {group.client_number}</span>}</h2>
          <ul>{group.items.map(item=><li key={item.id}><span className={`splits-check-box ${item.split_status==='split'?'checked':''}`}>{item.split_status==='split'?'✓':''}</span><div><strong>{item.sale_type} · {item.perfume_name??'(sem perfume)'}</strong><span>{[item.bottle_identifier,item.volume_ml!=null?`${item.volume_ml} ml`:null,item.split_status==='split'?'SEPARADO':'A SEPARAR'].filter(Boolean).join(' — ')}</span></div></li>)}</ul>
          <div className="splits-group-total"><span>{group.pending} a separar · {group.separated} separados</span><strong>{group.total_ml.toLocaleString('pt-BR')} ml</strong></div>
        </section>
      )}
      <section className="splits-document-footer">
        <div className="splits-document-signature"><span>Responsável:</span><div className="splits-line"/></div>
        <div className="splits-document-finished"><span>Finalizado em:</span><div className="splits-date-fields"><div className="splits-line short"/>/<div className="splits-line short"/>/<div className="splits-line short"/> &nbsp; <div className="splits-line short"/>:<div className="splits-line short"/></div></div>
        <div className="splits-document-notes"><span>Observações:</span><div className="splits-line"/><div className="splits-line"/></div>
      </section>
      <footer><span>RUAH Parfums</span><small>Documento operacional de separação de SPLIT e APC. Não é documento fiscal e não altera envio, pagamento ou estoque.</small></footer>
    </article>
  </main>
}
