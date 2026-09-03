import{forwardRef}from'react'
import{brl}from'../lib/format'
import{CollectionSaleRow}from'../lib/records'
import'./CollectionSummaryImageCard.css'

export type CollectionSummaryGroup={client_name:string;sales:CollectionSaleRow[];total:number}

/** Layout puro para captura (html-to-image) — só o que está nos dados: nenhum campo inventado (ex.: sem casa/marca separada, que a RPC de cobranças não expõe). */
export const CollectionSummaryImageCard=forwardRef<HTMLDivElement,{group:CollectionSummaryGroup}>(({group},ref)=>{
 const count=group.sales.length
 return<div ref={ref} className="collection-summary-image">
  <header>
   <img src="/ruah-brand.svg" alt="RUAH Parfums" className="collection-summary-logo"/>
   <p className="collection-summary-kicker">CONFIRMAÇÃO DO PEDIDO</p>
   <h2>{group.client_name}</h2>
   <p className="collection-summary-subtitle">{count} pedido{count===1?'':'s'} em aberto</p>
  </header>
  <ol className="collection-summary-list">
   {group.sales.map((sale,index)=><li key={sale.id}>
    <span className="collection-summary-index">{String(index+1).padStart(2,'0')}</span>
    <div className="collection-summary-item-body">
     <strong>{sale.perfume_name??'Perfume'}</strong>
     {sale.perfume_brand&&<span className="collection-summary-item-brand">{sale.perfume_brand}</span>}
     <span>{sale.sale_type??'—'} • {sale.volume_ml??'—'} ml • {brl(sale.amount)}</span>
    </div>
   </li>)}
  </ol>
  <footer>
   <div className="collection-summary-total">
    <span>VALOR TOTAL</span>
    <strong>{brl(group.total)}</strong>
   </div>
   <p className="collection-summary-institutional">RUAH PARFUMS • Conferência de pedidos em aberto</p>
  </footer>
 </div>
})
CollectionSummaryImageCard.displayName='CollectionSummaryImageCard'
