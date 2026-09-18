import{forwardRef}from'react'
import{brl}from'../lib/format'
import{OrganizationBrandMark,OrganizationBrand}from'./OrganizationBrandMark'
import'./CollectionSummaryImageCard.css'

export type CollectionSummaryLine={id:string;itemLabel:string;amount:number}
export type CollectionSummaryGroup={client_name:string;sales:CollectionSummaryLine[];total:number}

/**
 * pixelRatio usado na exportação deste card (ver download-image.ts) — 2,
 * não 3: o card já é renderizado no tamanho físico real (1080px, ver CSS),
 * então pixelRatio=2 já produz um PNG de 2160px de largura. Para uma
 * cobrança longa (ex.: 36 itens ~7-8mil px de altura a 1080px), pixelRatio=3
 * levaria a altura final a ~23 mil px — perto ou acima do limite de canvas
 * de navegadores móveis mais antigos. 2 é o maior valor que garante
 * nitidez alta sem esse risco.
 */
export const COLLECTION_IMAGE_PIXEL_RATIO=2

/**
 * Layout puro para captura (html-to-image) — universal: nenhum campo
 * de perfume/frasco/ml (ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md).
 * itemLabel vem pronto do chamador (fetchSaleItemsSummaries/
 * itemsSummaryLabel, mesmo mecanismo de Vendas/Planilha) para nunca
 * disparar uma busca assíncrona durante a captura da imagem — a marca
 * (brand) também é resolvida no componente pai e passada pronta, pelo
 * mesmo motivo.
 */
export const CollectionSummaryImageCard=forwardRef<HTMLDivElement,{group:CollectionSummaryGroup;brand:OrganizationBrand}>(({group,brand},ref)=>{
 const count=group.sales.length
 return<div ref={ref} className="collection-summary-image">
  <header>
   <OrganizationBrandMark brand={brand} print={false}/>
   <p className="collection-summary-kicker">RESUMO DE COBRANÇA</p>
   <h2>{group.client_name}</h2>
   <p className="collection-summary-subtitle">{count} pendência{count===1?'':'s'} em aberto</p>
  </header>
  <ol className="collection-summary-list">
   {group.sales.map((sale,index)=><li key={sale.id}>
    <span className="collection-summary-index">{String(index+1).padStart(2,'0')}</span>
    <div className="collection-summary-item-body">
     <strong>{sale.itemLabel}</strong>
     <span>{brl(sale.amount)}</span>
    </div>
   </li>)}
  </ol>
  <footer>
   <div className="collection-summary-total">
    <span>VALOR TOTAL</span>
    <strong>{brl(group.total)}</strong>
   </div>
   <p className="collection-summary-institutional">{brand.companyName.toUpperCase()} • Conferência de pendências em aberto</p>
  </footer>
 </div>
})
CollectionSummaryImageCard.displayName='CollectionSummaryImageCard'
