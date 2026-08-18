import { describe, expect, it } from 'vitest'
import { describeBottleScanResult, isBottleTrackedItem } from './shipment-bottle-scan'
import { BottleScanResult } from './records'

describe('describeBottleScanResult', () => {
  it('sucesso: informa o frasco e o quanto sobra', () => {
    const result: BottleScanResult = { ok: true, bottle_id: 'b1', bottle_code: 'F000185', bottle_label: 'Frasco 02', physical_ml: 82, needed_ml: 50 }
    expect(describeBottleScanResult(result)).toEqual({ tone: 'success', message: 'Frasco F000185 vinculado — 82 ml disponíveis.' })
  })
  it('frasco não encontrado: mensagem amigável, sem termo técnico', () => {
    expect(describeBottleScanResult({ ok: false, reason: 'bottle_not_found' })).toEqual({ tone: 'error', message: 'Não reconhecemos este frasco.' })
  })
  it('perfume errado: usa a frase exata do briefing (⚠ FRASCO DIFERENTE)', () => {
    const result: BottleScanResult = { ok: false, reason: 'wrong_perfume', bottle_label: 'Frasco 01', bottle_code: 'F000099' }
    expect(describeBottleScanResult(result).message).toContain('⚠ FRASCO DIFERENTE')
    expect(describeBottleScanResult(result).message).toContain('Frasco 01')
  })
  it('frasco vazio', () => {
    expect(describeBottleScanResult({ ok: false, reason: 'bottle_unavailable', status: 'empty' }).message).toBe('Este frasco está marcado como vazio.')
  })
  it('ml insuficiente: mostra disponível e necessário', () => {
    const result: BottleScanResult = { ok: false, reason: 'insufficient_ml', available_ml: 10, needed_ml: 50 }
    expect(describeBottleScanResult(result).message).toBe('Este frasco só tem 10 ml — o pedido precisa de 50 ml.')
  })
  it('frasco já usado noutro envio', () => {
    expect(describeBottleScanResult({ ok: false, reason: 'bottle_already_assigned' }).message).toBe('Este frasco já está separado para outro envio.')
  })
  it('todo resultado de erro usa tone error, sucesso usa tone success', () => {
    expect(describeBottleScanResult({ ok: false, reason: 'bottle_not_found' }).tone).toBe('error')
    expect(describeBottleScanResult({ ok: true, bottle_id: 'x', bottle_code: 'F1', bottle_label: 'F1', physical_ml: 1, needed_ml: 1 }).tone).toBe('success')
  })
})

describe('isBottleTrackedItem', () => {
  it('true quando stock_managed e bottle_tracking_status=active', () => {
    expect(isBottleTrackedItem({ inventory_allocations: { stock_managed: true, inventory_items: { bottle_tracking_status: 'active' } } })).toBe(true)
  })
  it('false quando bottle_tracking_status ainda é onboarding', () => {
    expect(isBottleTrackedItem({ inventory_allocations: { stock_managed: true, inventory_items: { bottle_tracking_status: 'onboarding' } } })).toBe(false)
  })
  it('false quando é custódia legada (stock_managed=false)', () => {
    expect(isBottleTrackedItem({ inventory_allocations: { stock_managed: false, inventory_items: { bottle_tracking_status: 'active' } } })).toBe(false)
  })
  it('false quando não há inventory_allocations (defensivo)', () => {
    expect(isBottleTrackedItem({ inventory_allocations: null })).toBe(false)
  })
})
