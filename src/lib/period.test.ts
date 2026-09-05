import { describe, expect, it } from 'vitest'
import { advanceBootPeriod, initialBootPeriodState, presetPeriod } from './period'
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

  describe('corte operacional (preset "operational")',()=>{
    const now=new Date(2026,8,5,12) // 05/09/2026, corresponde ao snapshot real usado no relatório
    it('resolve o início a partir da data operacional da organização, fim em hoje',()=>{
      expect(presetPeriod('operational',now,'2026-09-01')).toMatchObject({start:'2026-09-01',end:'2026-09-05',label:'Operação atual'})
    })
    it('organização sem corte configurado (null/undefined) cai em todo o histórico — nunca esconde dados por engano',()=>{
      expect(presetPeriod('operational',now,null)).toMatchObject({start:'1900-01-01',end:'2100-12-31'})
      expect(presetPeriod('operational',now)).toMatchObject({start:'1900-01-01',end:'2100-12-31'})
    })
    it('"all" continua sendo todo o histórico, sem qualquer influência do corte operacional',()=>{
      expect(presetPeriod('all',now,'2026-09-01')).toMatchObject({start:'1900-01-01',end:'2100-12-31'})
    })
  })

  describe('boot do período (App.tsx) — nunca fica pronto com TODO O HISTÓRICO antes de OPERAÇÃO ATUAL',()=>{
    const now=new Date(2026,8,5,12)
    it('nunca fica "ready" enquanto as permissões/config ainda carregam — nenhuma página pode montar e disparar fetch',()=>{
      const state=advanceBootPeriod(initialBootPeriodState(presetPeriod('all')),true,null,now)
      expect(state.ready).toBe(false)
    })
    it('assim que carrega, fica ready com o período JÁ resolvido para operação atual — jamais em duas etapas',()=>{
      let state=initialBootPeriodState(presetPeriod('all'))
      state=advanceBootPeriod(state,true,null,now) // ainda carregando
      expect(state.ready).toBe(false)
      state=advanceBootPeriod(state,false,'2026-09-01',now) // carregou: RUAH tem corte
      expect(state.ready).toBe(true)
      expect(state.period.start).toBe('2026-09-01') // nunca 1900-01-01 no primeiro "ready"
    })
    it('organização sem operational_sales_start_date configurado também fica ready — cai em todo o histórico, comportamento anterior preservado',()=>{
      const state=advanceBootPeriod(initialBootPeriodState(presetPeriod('all')),false,null,now)
      expect(state.ready).toBe(true)
      expect(state.period.start).toBe('1900-01-01')
    })
    it('sincroniza uma única vez: depois de pronto, uma escolha manual do usuário nunca é sobrescrita por um novo render',()=>{
      let state=advanceBootPeriod(initialBootPeriodState(presetPeriod('all')),false,'2026-09-01',now)
      state={...state,period:{start:'2026-01-01',end:'2026-01-31',label:'Período personalizado'}} // usuário escolheu outro período na tela
      state=advanceBootPeriod(state,false,'2026-09-01',now) // qualquer novo render (ex.: reload() de permissões)
      expect(state.period.start).toBe('2026-01-01')
    })
  })
})
