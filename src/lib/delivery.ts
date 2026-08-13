import { format } from 'date-fns'
import { CommercialSale } from './records'

export const todayIso=()=>format(new Date(),'yyyy-MM-dd')

export function deliveryState(sale:CommercialSale) {
  if(sale.shipped_at&&sale.shipping_deadline_date)return sale.shipped_at<=sale.shipping_deadline_date?'shipped_on_time':'shipped_late'
  if(sale.shipped_at)return 'shipped'
  if(sale.shipping_deadline_date)return sale.shipping_deadline_date<todayIso()?'overdue':'awaiting_shipment'
  return 'no_deadline'
}

export const deliveryLabels:Record<string,string>={awaiting_shipment:'Aguardando envio',overdue:'Envio atrasado',shipped_on_time:'Enviado no prazo',shipped_late:'Enviado com atraso',shipped:'Enviado',no_deadline:'Sem prazo'}

export const deliveryLabel=(sale:CommercialSale)=>deliveryLabels[deliveryState(sale)]
