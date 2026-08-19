/**
 * Priority 0B — pré-visualização de fracionamento, 100% local (briefing:
 * "No database writes during preview"). Só aritmética: nenhuma chamada de
 * rede acontece até o clique explícito de confirmação (splitBottle em
 * inventory-bottles.ts, que é quem realmente grava).
 */
export type SplitPreview = {
  totalMl: number; remainingMl: number; valid: boolean; error: string | null
}

export function computeSplitPreview(sourceAvailableMl: number, quantityPerVialMl: number, count: number): SplitPreview {
  if (!Number.isFinite(quantityPerVialMl) || quantityPerVialMl <= 0) {
    return { totalMl: 0, remainingMl: sourceAvailableMl, valid: false, error: 'Informe a quantidade por vidro (ml).' }
  }
  if (!Number.isInteger(count) || count <= 0) {
    return { totalMl: 0, remainingMl: sourceAvailableMl, valid: false, error: 'Informe quantos vidros gerar.' }
  }
  const totalMl = quantityPerVialMl * count
  const remainingMl = sourceAvailableMl - totalMl
  if (remainingMl < 0) {
    return { totalMl, remainingMl, valid: false, error: `O frasco fonte só tem ${sourceAvailableMl.toLocaleString('pt-BR')} ml — faltam ${Math.abs(remainingMl).toLocaleString('pt-BR')} ml.` }
  }
  return { totalMl, remainingMl, valid: true, error: null }
}
