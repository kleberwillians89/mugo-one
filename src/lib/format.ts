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

/** "Caroline Batistelli" → "caroline-batistelli". Usado para nomes de arquivo baixados (ex.: imagem de cobrança). */
export const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cliente'

export const plural = (count: number, singular: string, pluralForm: string) => count === 1 ? singular : pluralForm
export const countedLabel = (count: number, singular: string, pluralForm: string) => `${integer(count)} ${plural(count, singular, pluralForm)}`

const brazilianTimeZone = 'America/Sao_Paulo'
const isoCalendarDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/)
  if (!match) return null
  const [,year,month,day]=match,date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)))
  return date.getUTCFullYear()===Number(year)&&date.getUTCMonth()+1===Number(month)&&date.getUTCDate()===Number(day)
    ? `${day}/${month}/${year}`
    : null
}
const validDate = (value: string | Date | null | undefined) => {
  if (value == null || value === '') return null
  const parsed=value instanceof Date?value:new Date(value)
  return Number.isNaN(parsed.valueOf())?null:parsed
}

/** Formatação exclusivamente visual. Datas civis ISO preservam o dia da origem. */
export const shortDate = (value: string | Date | null | undefined) => {
  if(typeof value==='string'){
    const calendar=isoCalendarDate(value)
    if(calendar)return calendar
  }
  const parsed=validDate(value)
  return parsed?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:brazilianTimeZone}).format(parsed):'—'
}

/** Data e hora de exibição do CRM em pt-BR; nunca altera o valor persistido. */
export const dateTime = (value: string | Date | null | undefined) => {
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return shortDate(value)
  const parsed=validDate(value)
  return parsed?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:brazilianTimeZone}).format(parsed).replace(',', ''):'—'
}

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
