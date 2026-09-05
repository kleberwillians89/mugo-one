export type LegacyShippingConfirmation = 'pending' | 'sent' | 'not_sent'

export const legacyShippingLabels: Record<LegacyShippingConfirmation, string> = {
  pending: 'A CONFIRMAR',
  sent: 'ENVIADO',
  not_sent: 'NÃO ENVIADO',
}

export function legacyShippingState(value: string | null | undefined): LegacyShippingConfirmation {
  return value === 'sent' || value === 'not_sent' ? value : 'pending'
}

export function countLegacyShipping(rows: Array<{ legacy_shipping_confirmation?: string | null }>) {
  return rows.reduce((counts, row) => {
    counts[legacyShippingState(row.legacy_shipping_confirmation)] += 1
    return counts
  }, { pending: 0, sent: 0, not_sent: 0 } as Record<LegacyShippingConfirmation, number>)
}

export type ParsedLegacyShippingInput = { confirmation: LegacyShippingConfirmation; shippingDate: string | null }

export function parseLegacyShippingInput(value: string): ParsedLegacyShippingInput {
  const normalized=value.trim()
  if(!normalized)return {confirmation:'pending',shippingDate:null}
  if(normalized.toUpperCase()==='X')return {confirmation:'not_sent',shippingDate:null}
  const match=normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if(!match)throw new Error('Digite uma data válida em DD/MM/AAAA ou X.')
  const [,day,month,year]=match,iso=`${year}-${month}-${day}`
  const date=new Date(`${iso}T12:00:00Z`)
  if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day))throw new Error('Digite uma data válida em DD/MM/AAAA ou X.')
  return {confirmation:'sent',shippingDate:iso}
}

export function formatLegacyShippingInput(confirmation: string | null | undefined, shippingDate: string | null | undefined) {
  if(legacyShippingState(confirmation)==='not_sent')return 'X'
  if(legacyShippingState(confirmation)==='sent'&&shippingDate){const [year,month,day]=shippingDate.slice(0,10).split('-');return `${day}/${month}/${year}`}
  return ''
}
