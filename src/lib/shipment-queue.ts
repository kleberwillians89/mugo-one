import { OperationalShipment } from './records'
import { Stage, shipmentStage } from './superfrete'

// Menor número = precisa de mais trabalho = trabalhar primeiro. "posted"/
// "delivered" ficam no fim — não é mais fila de trabalho da Ilde.
const STAGE_WEIGHT: Record<Stage, number> = { preparing: 0, conference: 1, freight: 2, label: 3, posted: 4, delivered: 5 }

const URGENT_WITHIN_DAYS = 2

/** Um envio é urgente se qualquer venda que o compõe tem prazo de envio vencendo em até 2 dias (ou já vencido) e o envio ainda não foi postado. Cobre "já vencido" e "vence em breve" com a mesma comparação, já que hoje <= cutoff sempre. */
export function isUrgentShipment(shipment: OperationalShipment): boolean {
  if (shipment.status === 'posted' || shipment.status === 'delivered') return false
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + URGENT_WITHIN_DAYS)
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  return shipment.shipment_items.some((item) => {
    const deadline = item.sales?.shipping_deadline_date
    return Boolean(deadline && deadline <= cutoffIso)
  })
}

/** Fase 4 (Smart Shipping Queue) — "Qual pedido preparo agora?": urgente primeiro, depois por etapa (quem precisa de mais trabalho primeiro), depois o mais antigo dentro do mesmo grupo — nada fica esquecido só por ser mais recente. */
export function sortShipmentQueue(rows: OperationalShipment[]): OperationalShipment[] {
  return [...rows].sort((a, b) => {
    const urgentA = isUrgentShipment(a) ? 0 : 1
    const urgentB = isUrgentShipment(b) ? 0 : 1
    if (urgentA !== urgentB) return urgentA - urgentB
    const stageA = STAGE_WEIGHT[shipmentStage(a)]
    const stageB = STAGE_WEIGHT[shipmentStage(b)]
    if (stageA !== stageB) return stageA - stageB
    return a.created_at.localeCompare(b.created_at)
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Nota de controle do envio (impressão, briefing "Priority 0"): o Code128
 * carrega o shipment.id inteiro (o identificador canônico já existente —
 * nenhum esquema de código curto novo foi inventado só para impressão).
 * Frascos nunca têm essa forma (são "MUGO-Fxxxxxx", ou "RUAH-Fxxxxxx" para códigos legados), então o mesmo leitor
 * de scanner distingue os dois tipos de bipagem sem nenhuma coordenação
 * extra: um valor que não é UUID simplesmente não é um envio.
 */
export function shipmentIdFromScan(value: string): string | null {
  const trimmed = value.trim()
  return UUID_RE.test(trimmed) ? trimmed : null
}

/** QR payload da nota de controle: aponta para o próprio Envio 360 autenticado — nunca dados de cliente/financeiro no payload em si (briefing: "Do NOT encode customer PII... QR should identify/resolve the record. Data remains inside authenticated CRM."). */
export function shipmentControlDeepLink(shipmentId: string, origin = location.origin): string {
  return `${origin}/entregas/${shipmentId}`
}
