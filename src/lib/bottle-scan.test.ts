import { describe, expect, it } from 'vitest'
import {
  apcLabel, computeConferenceDiff, computeTrackingReconciliation, formatDelta, formatMl, parseScannedValue,
} from './bottle-scan'

const TOKEN = 'a'.repeat(64)

describe('parseScannedValue', () => {
  it('extrai o token de uma URL completa de QR (deep link)', () => {
    expect(parseScannedValue(`https://crmruahparfums.vercel.app/q/${TOKEN}`)).toEqual({ kind: 'token', value: TOKEN })
  })
  it('aceita a URL sem protocolo/host (o navegador já resolveu a rota)', () => {
    expect(parseScannedValue(`/q/${TOKEN}`)).toEqual({ kind: 'token', value: TOKEN })
  })
  it('aceita um token bruto (64 hex) sem wrapper de URL', () => {
    expect(parseScannedValue(TOKEN)).toEqual({ kind: 'token', value: TOKEN })
  })
  it('reconhece o valor completo do barcode (RUAH-F000185) vindo do bipador', () => {
    expect(parseScannedValue('RUAH-F000185')).toEqual({ kind: 'code', value: 'F000185' })
  })
  it('reconhece o barcode em minúsculas', () => {
    expect(parseScannedValue('ruah-f000185')).toEqual({ kind: 'code', value: 'F000185' })
  })
  it('reconhece o código curto digitado manualmente (seção 24)', () => {
    expect(parseScannedValue('F000185')).toEqual({ kind: 'code', value: 'F000185' })
  })
  it('ignora espaços em volta do valor lido', () => {
    expect(parseScannedValue('  F000185  ')).toEqual({ kind: 'code', value: 'F000185' })
  })
  it('rejeita lixo não reconhecível', () => {
    expect(parseScannedValue('qualquer coisa aleatória')).toBeNull()
  })
  it('rejeita string vazia', () => {
    expect(parseScannedValue('   ')).toBeNull()
  })

  describe('split (L/N/O — resolvedor canônico também cobre split, não só frasco)', () => {
    it('reconhece o valor completo do barcode do split (RUAH-S000185-001)', () => {
      expect(parseScannedValue('RUAH-S000185-001')).toEqual({ kind: 'split', value: 'S000185-001' })
    })
    it('reconhece o split_code curto digitado manualmente, sem o prefixo RUAH-', () => {
      expect(parseScannedValue('S000185-001')).toEqual({ kind: 'split', value: 'S000185-001' })
    })
    it('reconhece em minúsculas', () => {
      expect(parseScannedValue('ruah-s000185-001')).toEqual({ kind: 'split', value: 'S000185-001' })
    })
    it('nunca confunde um código de split com um código de frasco — prefixos S/F são mutuamente exclusivos', () => {
      expect(parseScannedValue('RUAH-S000185-001')?.kind).toBe('split')
      expect(parseScannedValue('RUAH-F000185')?.kind).toBe('code')
    })
  })
})

describe('computeConferenceDiff', () => {
  it('82 → 79: diferença negativa de 3ml', () => {
    expect(computeConferenceDiff(82, 79)).toEqual({ before: 82, after: 79, delta: -3, changed: true })
  })
  it('82 → 82: sem diferença, changed=false (seção 8/27 do briefing anterior)', () => {
    expect(computeConferenceDiff(82, 82)).toEqual({ before: 82, after: 82, delta: 0, changed: false })
  })
  it('82 → 0: frasco vazio, permitido, delta correto', () => {
    expect(computeConferenceDiff(82, 0)).toEqual({ before: 82, after: 0, delta: -82, changed: true })
  })
  it('arredonda ruído de ponto flutuante em 3 casas decimais', () => {
    expect(computeConferenceDiff(0.1, 0.2).delta).toBeCloseTo(0.1, 3)
  })
})

describe('formatMl / formatDelta', () => {
  it('formata ml em pt-BR', () => { expect(formatMl(1234.5)).toBe('1.234,5 ml') })
  it('formata delta positivo com sinal', () => { expect(formatDelta(3)).toBe('+3 ml') })
  it('formata delta negativo com o próprio sinal do número', () => { expect(formatDelta(-3)).toBe('-3 ml') })
})

describe('apcLabel', () => {
  it('1 de 1 quando disponível', () => { expect(apcLabel(true)).toEqual({ headline: '1 DE 1', status: 'APC DISPONÍVEL' }) })
  it('0 de 1 quando indisponível', () => { expect(apcLabel(false)).toEqual({ headline: '0 DE 1', status: 'APC INDISPONÍVEL' }) })
})

describe('computeTrackingReconciliation', () => {
  it('180 sistema, 180 identificado (100+80): concilia', () => {
    expect(computeTrackingReconciliation(180, 100 + 80)).toEqual({ systemMl: 180, identifiedMl: 180, diff: 0, reconciled: true })
  })
  it('180 sistema, 178 identificado: reporta -2, nunca corrige sozinho', () => {
    expect(computeTrackingReconciliation(180, 178)).toEqual({ systemMl: 180, identifiedMl: 178, diff: -2, reconciled: false })
  })
})
