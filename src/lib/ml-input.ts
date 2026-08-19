/**
 * Parsing/validação de campos de quantidade em ml digitados pelo operador.
 * O backend (inventory_apply etc.) sempre recebe um número puro — 100, não
 * "100ml" — então esta é a fronteira que existe SÓ para dar uma mensagem
 * específica quando o operador digita a unidade dentro do campo numérico
 * (achado no smoke do Estoque: "100ml" em vez de "100"), em vez da
 * mensagem genérica de formulário incompleto.
 */

/** Aceita vírgula OU ponto decimal (pt-BR). Retorna null se não for um número puro. */
export function parseMlAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/** true só quando o motivo do parse falhar é especificamente a unidade "ml" colada ao número (ex.: "100ml", "5 ML"). */
export function looksLikeMlWithUnitSuffix(raw: string): boolean {
  return /^-?\d+([.,]\d+)?\s*ml$/i.test(raw.trim())
}
