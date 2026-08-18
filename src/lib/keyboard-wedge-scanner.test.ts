import { describe, expect, it } from 'vitest'
import { KeyboardWedgeBuffer } from './keyboard-wedge-scanner'

function typeFast(buffer: KeyboardWedgeBuffer, text: string, start = 0, gapMs = 8) {
  let t = start
  for (const char of text) { buffer.push(char, t); t += gapMs }
  return buffer.submit(t)
}

describe('KeyboardWedgeBuffer', () => {
  it('reconhece um bip rápido terminado em Enter como scan', () => {
    const buffer = new KeyboardWedgeBuffer()
    expect(typeFast(buffer, 'RUAH-F000185')).toEqual({ type: 'scan', value: 'RUAH-F000185' })
  })

  it('não confunde digitação humana lenta com um bip (seção 11: bipador, não teclado normal)', () => {
    const buffer = new KeyboardWedgeBuffer()
    let t = 0
    for (const char of 'F000185') { buffer.push(char, t); t += 300 } // ~300ms entre teclas: humano digitando
    expect(buffer.submit(t)).toEqual({ type: 'idle' })
  })

  it('ignora um Enter perdido sem nenhuma tecla antes (não é scan)', () => {
    const buffer = new KeyboardWedgeBuffer()
    expect(buffer.submit(0)).toEqual({ type: 'idle' })
  })

  it('rejeita bursts rápidos mas curtos demais para ser um código real', () => {
    const buffer = new KeyboardWedgeBuffer()
    expect(typeFast(buffer, 'F1')).toEqual({ type: 'idle' })
  })

  it('um gap grande no meio da digitação reinicia o buffer (só conta o último burst)', () => {
    const buffer = new KeyboardWedgeBuffer()
    buffer.push('X', 0); buffer.push('X', 5) // burst descartado
    let t = 500
    for (const char of 'RUAH-F000185') { buffer.push(char, t); t += 8 }
    expect(buffer.submit(t)).toEqual({ type: 'scan', value: 'RUAH-F000185' })
  })

  it('depois de um scan, o buffer está limpo para o próximo (seção 1: LER PRÓXIMO)', () => {
    const buffer = new KeyboardWedgeBuffer()
    typeFast(buffer, 'RUAH-F000185')
    expect(typeFast(buffer, 'RUAH-F000222', 1000)).toEqual({ type: 'scan', value: 'RUAH-F000222' })
  })

  it('reset() limpa manualmente sem precisar de submit', () => {
    const buffer = new KeyboardWedgeBuffer()
    buffer.push('F', 0); buffer.push('0', 5)
    buffer.reset()
    expect(buffer.submit(10)).toEqual({ type: 'idle' })
  })
})
