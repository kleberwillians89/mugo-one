import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OPERATIONAL_START_DATE,
  isOperationalSaleDate,
  operationalPeriod,
  operationalRows,
  withOperationalDaviFilters,
} from './operational-sales'

type Sale = { sale_date: string; amount: number; client: string; type: 'APC' | 'SPLIT' }
const sales: Sale[] = [
  { sale_date: '2026-08-30', amount: 100, client: 'Agosto 30', type: 'SPLIT' },
  { sale_date: '2026-08-31', amount: 200, client: 'Agosto 31', type: 'APC' },
  { sale_date: '2026-09-01', amount: 300, client: 'Setembro 1', type: 'SPLIT' },
  { sale_date: '2026-09-05', amount: 400, client: 'Setembro 5', type: 'APC' },
]

describe('domínio central da operação atual', () => {
  it('define uma única data canônica e exclui 30/08 e 31/08', () => {
    expect(OPERATIONAL_START_DATE).toBe('2026-09-01')
    expect(isOperationalSaleDate('2026-08-30')).toBe(false)
    expect(isOperationalSaleDate('2026-08-31')).toBe(false)
  })

  it('inclui 01/09 e 05/09', () => {
    expect(isOperationalSaleDate('2026-09-01')).toBe(true)
    expect(isOperationalSaleDate('2026-09-05')).toBe(true)
  })

  it('total operacional, busca e filtros jamais reintroduzem o histórico', () => {
    const operational = operationalRows(sales)
    expect(operational.reduce((sum, sale) => sum + sale.amount, 0)).toBe(700)
    expect(operational.filter((sale) => sale.client.toLowerCase().includes('agosto'))).toEqual([])
    expect(operational.filter((sale) => sale.type === 'APC')).toEqual([sales[3]])
  })

  it('transforma Todo o período em Todas as vendas da operação atual', () => {
    expect(operationalPeriod({ start: '1900-01-01', end: '2100-12-31', label: 'Todo o período' }))
      .toEqual({ start: '2026-09-01', end: '2100-12-31', label: 'Operação atual' })
  })

  it('injeta o mesmo piso na paginação, busca e filtros da grade Davi', () => {
    expect(withOperationalDaviFilters({ search: 'cliente', columns: { type: { values: ['SPLIT'] } } }))
      .toMatchObject({ search: 'cliente', columns: { type: { values: ['SPLIT'] }, sale_date: { condition: { operator: 'after', value: '2026-08-31' } } } })
    expect(withOperationalDaviFilters({ columns: { sale_date: { condition: { operator: 'before', value: '2026-09-05' } } } }))
      .toMatchObject({ columns: { sale_date: { condition: { operator: 'between', value: '2026-09-01', value2: '2026-09-04' } } } })
  })
})

describe('contratos das telas operacionais', () => {
  const records = readFileSync(new URL('./records.ts', import.meta.url), 'utf8')
  const validation = readFileSync(new URL('./sales-validation.ts', import.meta.url), 'utf8')
  const diagnostic = readFileSync(new URL('./davi-import-diagnostics.ts', import.meta.url), 'utf8')
  const client360 = records.slice(records.indexOf('export async function fetchClient360'), records.indexOf('export async function createDraftShipment'))
  const readOnlySlices = [
    records.slice(records.indexOf('export async function fetchPeriodSummary'), records.indexOf('export type DashboardActivityItem')),
    records.slice(records.indexOf('export async function fetchDaviExcel('), records.indexOf('export async function fetchDaviExcelSaleEdit')),
    records.slice(records.indexOf('export async function fetchSalesPage'), records.indexOf('export async function confirmSaleShippingAvailability')),
    records.slice(records.indexOf('export async function fetchDeliveryRows'), records.indexOf('export async function updateShipment')),
    records.slice(records.indexOf('export async function askIntelligence'), records.indexOf('export type PerfumeCommercialSummary')),
    validation.slice(validation.indexOf('export async function fetchSalesValidationQueue'), validation.indexOf('export function goToSalesBlocked')),
    diagnostic.slice(diagnostic.indexOf('async function allRows'), diagnostic.indexOf('export async function analyzeDaviFile')),
  ].join('\n')

  it('Dashboard, Vendas, Entregas, Relatórios e IA recebem o piso antes de consultar', () => {
    expect(records).toContain('const operational=operationalPeriod(period)')
    expect(records).toContain("query=query.gte('sale_date',period.start).lte('sale_date',period.end)")
    expect(records).toContain("query=query.gte('sale_date',operational.start).lte('sale_date',operational.end)")
    expect(records).toContain('period_start:operational.start,period_end:operational.end')
  })

  it('Davi Excel, fila de bloqueadas e diagnóstico atual excluem vendas históricas', () => {
    expect(records).toContain('withOperationalDaviFilters(filters)')
    expect(validation).toContain('operationalRows((data ?? []) as BlockedSale[])')
    expect(diagnostic).toContain("organizationId,OPERATIONAL_START_DATE)")
  })

  it('Cliente 360 preserva deliberadamente o histórico individual completo', () => {
    expect(client360).toContain("from('sales')")
    expect(client360).not.toContain('OPERATIONAL_START_DATE')
    expect(client360).not.toContain('operationalPeriod')
    expect(client360).not.toContain("gte('sale_date'")
  })

  it('a correção é somente leitura e não adiciona mutação de banco', () => {
    expect(readOnlySlices).not.toMatch(/\.from\([^)]*\)\.(?:insert|upsert|update|delete)\(/)
  })
})
