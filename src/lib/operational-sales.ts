import type { PeriodValue } from './period'

/** Primeiro dia canônico da operação atual da RUAH. */
export const OPERATIONAL_START_DATE = '2026-09-01'

export function operationalStartDate(configured?: string | null) {
  return configured && /^\d{4}-\d{2}-\d{2}$/.test(configured) && configured >= OPERATIONAL_START_DATE ? configured : OPERATIONAL_START_DATE
}

/**
 * Impõe o piso operacional mesmo quando uma tela recebe "Todo o período"
 * ou um intervalo histórico persistido por navegação. O fim é preservado:
 * um intervalo inteiramente anterior ao corte produz uma consulta vazia.
 */
export function operationalPeriod(period: PeriodValue, configured?: string | null): PeriodValue {
  const floor = operationalStartDate(configured)
  if (period.start >= floor) return period
  return { ...period, start: floor, label: period.label === 'Todo o período' ? 'Operação atual' : period.label }
}

export function isOperationalSaleDate(value: string | null | undefined, configured?: string | null) {
  return Boolean(value && value >= operationalStartDate(configured))
}

export function operationalRows<T extends { sale_date?: string | null }>(rows: T[], configured?: string | null) {
  return rows.filter((row) => isOperationalSaleDate(row.sale_date, configured))
}

const previousIsoDay = (iso: string) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

type DateCondition = { operator: string; value?: string; value2?: string }
type DaviFilters = { columns?: Record<string, { values?: string[]; condition?: DateCondition }>; [key: string]: unknown }

/** Combina o filtro de DATA do Davi com o piso operacional usando AND. */
export function withOperationalDaviFilters<T extends DaviFilters>(filters: T, configured?: string | null): T {
  const floor = operationalStartDate(configured)
  const columns = { ...(filters.columns ?? {}) }
  const current = columns.sale_date ?? {}
  const values = current.values?.filter((value) => value >= floor)
  const condition = current.condition
  let nextCondition: DateCondition = { operator: 'after', value: previousIsoDay(floor) }
  let impossible = Boolean(current.values && values?.length === 0)

  if (condition?.operator === 'eq' && condition.value) {
    impossible ||= condition.value < floor
    nextCondition = condition
  } else if (condition?.operator === 'after' && condition.value) {
    nextCondition = { operator: 'after', value: condition.value >= floor ? condition.value : previousIsoDay(floor) }
  } else if (condition?.operator === 'before' && condition.value) {
    impossible ||= condition.value <= floor
    nextCondition = { operator: 'between', value: floor, value2: previousIsoDay(condition.value) }
  } else if (condition?.operator === 'between' && condition.value && condition.value2) {
    impossible ||= condition.value2 < floor
    nextCondition = { operator: 'between', value: condition.value < floor ? floor : condition.value, value2: condition.value2 }
  }

  columns.sale_date = { ...current, ...((current.values || impossible) ? { values: impossible ? [] : values } : {}), condition: nextCondition }
  return { ...filters, columns } as T
}
