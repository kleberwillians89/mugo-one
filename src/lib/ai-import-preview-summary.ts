import {normalizeClient} from './importer'
import {normalizeInventoryPerfumeName} from './ai-inventory'
import type {AiSalesBatchPreview,AiSalesBatchSale} from './records'

export type PreviewSaleSummary={
  index:number;label:string;orderNumber:string|null;client:string;perfume:string;saleType:string;volumeMl:number;amount:number
}
export type PreviewAggregate={key:string;label:string;sales:number;volumeMl:number;amount:number}
export type AiImportPreviewSummary={sales:number;clients:number;volumeMl:number;amount:number;orders:PreviewSaleSummary[];byClient:PreviewAggregate[];byPerfume:PreviewAggregate[];pendingPerfumes:number}

const rounded=(value:number)=>Math.round(value*100)/100
const validSale=(sale:AiSalesBatchSale)=>sale.is_importable!==false&&Number.isFinite(sale.volume_ml)&&sale.volume_ml>0&&Number.isFinite(sale.amount)&&sale.amount>=0
const clientIdentity=(sale:AiSalesBatchSale)=>{
  if(sale.client_id)return`id:${sale.client_id}`
  const email=String(sale.client_email??sale.client?.email??'').trim().toLowerCase()
  if(email)return`email:${email}`
  const cpf=String(sale.client_cpf??sale.client?.cpf??'').replace(/\D/g,'')
  if(cpf)return`cpf:${cpf}`
  return`name:${normalizeClient(sale.client_name)}`
}
const add=(map:Map<string,PreviewAggregate>,key:string,label:string,sale:AiSalesBatchSale)=>{const prior=map.get(key);map.set(key,{key,label,sales:(prior?.sales??0)+1,volumeMl:rounded((prior?.volumeMl??0)+sale.volume_ml),amount:rounded((prior?.amount??0)+sale.amount)})}

export function buildAiImportPreviewSummary(preview:AiSalesBatchPreview):AiImportPreviewSummary{
  const sales=preview.sales.filter(validSale),clients=new Map<string,PreviewAggregate>(),perfumes=new Map<string,PreviewAggregate>()
  const resolvedGroups=new Map((preview.groups??[]).filter(group=>group.inventory_item_id).map(group=>[group.normalized_perfume_name,group]))
  const singleResolved=Boolean(preview.inventory_item_id)
  const orders=sales.map((sale,index)=>{
    add(clients,clientIdentity(sale),sale.client_name,sale)
    const normalizedPerfume=normalizeInventoryPerfumeName(sale.perfume_name??preview.perfume)
    const group=resolvedGroups.get(normalizedPerfume)
    if(group)add(perfumes,`id:${group.perfume_id??group.inventory_item_id}`,String(group.inventory?.perfume??group.display_name??group.perfume),sale)
    else if(singleResolved)add(perfumes,`id:${preview.perfume_id??preview.inventory_item_id}`,String(preview.inventory?.perfume??preview.display_name??preview.perfume),sale)
    const orderNumber=String(sale.order_number??sale.source_order_number??'').trim()||null
    return{index,label:orderNumber?`Pedido #${orderNumber}`:`Venda ${String(index+1).padStart(2,'0')}`,orderNumber,client:sale.client_name,perfume:sale.perfume_name??preview.display_name??preview.perfume,saleType:sale.sale_type==='SPLIT'?'Split':'APC',volumeMl:sale.volume_ml,amount:sale.amount}
  })
  return{
    sales:sales.length,clients:clients.size,
    volumeMl:rounded(sales.reduce((sum,sale)=>sum+sale.volume_ml,0)),amount:rounded(sales.reduce((sum,sale)=>sum+sale.amount,0)),
    orders,byClient:[...clients.values()],byPerfume:[...perfumes.values()],
    pendingPerfumes:preview.source_format==='tsv'?(preview.groups??[]).filter(group=>!group.inventory_item_id).length:preview.inventory_item_id?0:1,
  }
}
