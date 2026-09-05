export type LegacyShippingStatus = 'confirmed' | 'to_send' | 'out_of_stock'

export const legacyShippingStatusLabels: Record<LegacyShippingStatus, string> = {
  confirmed: 'CONFIRMADO',
  to_send: 'A ENVIAR',
  out_of_stock: 'SEM ESTOQUE',
}

export function legacyShippingStatusLabel(status: string | null | undefined) {
  return status&&status in legacyShippingStatusLabels?legacyShippingStatusLabels[status as LegacyShippingStatus]:'SEM CLASSIFICAÇÃO'
}

export function parseLegacyShippingStatus(value: string): LegacyShippingStatus | null {
  const normalized=value.trim().toLocaleUpperCase('pt-BR')
  if(!normalized)return null
  if(normalized==='C'||normalized==='CONFIRMADO')return 'confirmed'
  if(normalized==='A'||normalized==='A ENVIAR')return 'to_send'
  if(normalized==='S'||normalized==='SEM ESTOQUE')return 'out_of_stock'
  throw new Error('Use CONFIRMADO, A ENVIAR ou SEM ESTOQUE.')
}

export function countLegacyShippingStatuses(rows: Array<{legacy_shipping_status?:string|null}>) {
  return rows.reduce((counts,row)=>{
    const status=row.legacy_shipping_status
    if(status==='confirmed'||status==='to_send'||status==='out_of_stock')counts[status]+=1
    else counts.unclassified+=1
    return counts
  },{confirmed:0,to_send:0,out_of_stock:0,unclassified:0})
}
