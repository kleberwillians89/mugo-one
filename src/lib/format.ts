export const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

export const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

/** Número operacional do cliente: 1 → "001", 25 → "025", 471 → "471",
 * 1000 → "1000". Só apresentação; nunca deriva de índice de tela. */
export const clientNumber = (value: number | null | undefined) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return String(Math.trunc(n)).padStart(3, '0')
}

export const plural = (count: number, singular: string, pluralForm: string) => count === 1 ? singular : pluralForm
export const countedLabel = (count: number, singular: string, pluralForm: string) => `${integer(count)} ${plural(count, singular, pluralForm)}`

export const shortDate = (value: string | Date) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`
    : new Intl.DateTimeFormat('pt-BR', { timeZone:'America/Sao_Paulo' }).format(new Date(value))

export const monthLabel = (month: string) => {
  const [year, m] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
    .format(new Date(year, m - 1, 1)).replace('.', '')
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

export const monthYearLabel = (value: string) => {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
    .format(new Date(value))
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}
