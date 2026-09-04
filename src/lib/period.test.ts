import { describe, expect, it } from 'vitest'
import { presetPeriod } from './period'
import { dateTime, shortDate } from './format'

describe('períodos comerciais em pt-BR', () => {
  const now=new Date(2026,6,29,12)
  it('calcula atalhos sem deslocamento UTC',()=>{
    expect(presetPeriod('today',now)).toMatchObject({start:'2026-07-29',end:'2026-07-29'})
    expect(presetPeriod('7d',now)).toMatchObject({start:'2026-07-23',end:'2026-07-29'})
    expect(presetPeriod('month',now)).toMatchObject({start:'2026-07-01',end:'2026-07-29'})
  })
  it('calcula mês anterior e trimestre',()=>{
    expect(presetPeriod('previous_month',now)).toMatchObject({start:'2026-06-01',end:'2026-06-30'})
    expect(presetPeriod('quarter',now)).toMatchObject({start:'2026-07-01',end:'2026-07-29'})
  })
  it('formata ISO como DD/MM/AAAA sem mudar o dia',()=>{
    expect(shortDate('2026-07-01')).toBe('01/07/2026')
  })
  it('formata data/hora em pt-BR e controla valores nulos ou inválidos',()=>{
    expect(dateTime('2026-09-04T17:35:00Z')).toBe('04/09/2026 14:35')
    expect(shortDate(null)).toBe('—')
    expect(shortDate('2026-99-99')).toBe('—')
    expect(dateTime('inválida')).toBe('—')
  })
})
