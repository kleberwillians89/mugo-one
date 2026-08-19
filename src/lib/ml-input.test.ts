import { describe, expect, it } from 'vitest'
import { looksLikeMlWithUnitSuffix, parseMlAmount } from './ml-input'

describe('parseMlAmount — G: sempre número puro, nunca "100ml"', () => {
  it('aceita número inteiro', () => { expect(parseMlAmount('100')).toBe(100) })
  it('aceita decimal com ponto', () => { expect(parseMlAmount('5.5')).toBe(5.5) })
  it('aceita decimal com vírgula (pt-BR)', () => { expect(parseMlAmount('5,5')).toBe(5.5) })
  it('ignora espaços em volta', () => { expect(parseMlAmount('  100  ')).toBe(100) })
  it('string vazia não é um número', () => { expect(parseMlAmount('')).toBeNull() })
  it('"100ml" (o bug real do smoke) não é aceito como número', () => { expect(parseMlAmount('100ml')).toBeNull() })
  it('"5ml" também não é aceito', () => { expect(parseMlAmount('5ml')).toBeNull() })
  it('lixo não numérico não é aceito', () => { expect(parseMlAmount('abc')).toBeNull() })
})

describe('looksLikeMlWithUnitSuffix — H: distingue "digitou a unidade" de "digitou lixo"', () => {
  it('detecta "100ml"', () => { expect(looksLikeMlWithUnitSuffix('100ml')).toBe(true) })
  it('detecta "5 ML" (maiúsculo, com espaço)', () => { expect(looksLikeMlWithUnitSuffix('5 ML')).toBe(true) })
  it('detecta decimal com unidade: "5,5ml"', () => { expect(looksLikeMlWithUnitSuffix('5,5ml')).toBe(true) })
  it('não marca um número puro como tendo sufixo', () => { expect(looksLikeMlWithUnitSuffix('100')).toBe(false) })
  it('não marca lixo não relacionado como sufixo de unidade', () => { expect(looksLikeMlWithUnitSuffix('abc')).toBe(false) })
})
