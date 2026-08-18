import { describe, expect, it } from 'vitest'
import { QrScanDedup } from './qr-scan-dedup'

describe('QrScanDedup', () => {
  it('aceita a primeira leitura de um valor', () => {
    const dedup = new QrScanDedup()
    expect(dedup.shouldAccept('token-a', 0)).toBe(true)
  })

  it('rejeita o mesmo valor em frames consecutivos (seção 12)', () => {
    const dedup = new QrScanDedup()
    dedup.shouldAccept('token-a', 0)
    expect(dedup.shouldAccept('token-a', 33)).toBe(false)
    expect(dedup.shouldAccept('token-a', 66)).toBe(false)
  })

  it('aceita o mesmo valor de novo depois do cooldown (permite reler o mesmo frasco)', () => {
    const dedup = new QrScanDedup()
    dedup.shouldAccept('token-a', 0)
    expect(dedup.shouldAccept('token-a', 2000)).toBe(true)
  })

  it('aceita imediatamente um valor diferente (próximo frasco, sem esperar cooldown)', () => {
    const dedup = new QrScanDedup()
    dedup.shouldAccept('token-a', 0)
    expect(dedup.shouldAccept('token-b', 10)).toBe(true)
  })

  it('reset() permite reaceitar o mesmo valor imediatamente', () => {
    const dedup = new QrScanDedup()
    dedup.shouldAccept('token-a', 0)
    dedup.reset()
    expect(dedup.shouldAccept('token-a', 10)).toBe(true)
  })
})
