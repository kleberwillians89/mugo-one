import{forwardRef}from'react'
import{brl}from'../lib/format'
import{OrganizationBrandMark,useOrganizationBrand}from'./OrganizationBrandMark'
import'./InventoryOfferImageCard.css'

export type InventoryOfferImageData={perfume:string;availableMl:number;pricePerMl:number|null;bottles:string[]}
export const INVENTORY_OFFER_IMAGE_PIXEL_RATIO=2

export const InventoryOfferImageCard=forwardRef<HTMLDivElement,{offer:InventoryOfferImageData}>(({offer},ref)=>{
 const brand=useOrganizationBrand()
 return<div ref={ref} className="inventory-offer-image">
  <header><OrganizationBrandMark brand={brand}/><span>FRASCO EM ABERTO</span></header>
  <main><p>OPORTUNIDADE</p><h2>{offer.perfume}</h2>{offer.bottles.length>0&&<div className="inventory-offer-bottles">{offer.bottles.map(label=><b key={label}>{label}</b>)}</div>}
    <div className="inventory-offer-available"><span>DISPONÍVEL PARA VENDA</span><strong>{offer.availableMl.toLocaleString('pt-BR')} <small>ML</small></strong></div>
    <div className="inventory-offer-price"><span>VALOR POR ML</span><strong>{offer.pricePerMl===null?'CONSULTE':brl(offer.pricePerMl)}</strong></div>
  </main>
  <footer><span>{brand.companyName.toUpperCase()}</span><small>Consulte disponibilidade no grupo</small></footer>
 </div>
})
InventoryOfferImageCard.displayName='InventoryOfferImageCard'
