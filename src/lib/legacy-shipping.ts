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
