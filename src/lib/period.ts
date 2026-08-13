import { format, parseISO, subDays } from 'date-fns'

export type PeriodValue = { start:string; end:string; label:string }
export type PeriodPreset = 'today'|'yesterday'|'7d'|'30d'|'month'|'previous_month'|'quarter'|'year'|'all'|'custom'
const localIso = (date:Date) => format(date,'yyyy-MM-dd')

export function presetPeriod(preset:PeriodPreset,now=new Date()):PeriodValue {
  const end=new Date(now),start=new Date(now)
  start.setHours(12,0,0,0);end.setHours(12,0,0,0)
  const labels:Record<PeriodPreset,string>={today:'Hoje',yesterday:'Ontem','7d':'Últimos 7 dias','30d':'Últimos 30 dias',month:'Este mês',previous_month:'Mês anterior',quarter:'Este trimestre',year:'Este ano',all:'Todo o período',custom:'Período personalizado'}
  if(preset==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1)}
  if(preset==='7d')start.setDate(start.getDate()-6)
  if(preset==='30d')start.setDate(start.getDate()-29)
  if(preset==='month')start.setDate(1)
  if(preset==='previous_month'){start.setMonth(start.getMonth()-1,1);end.setDate(0)}
  if(preset==='quarter')start.setMonth(Math.floor(start.getMonth()/3)*3,1)
  if(preset==='year')start.setMonth(0,1)
  if(preset==='all'){start.setFullYear(1900,0,1);end.setFullYear(2100,11,31)}
  return {start:localIso(start),end:localIso(end),label:labels[preset]}
}
export const defaultPeriod=()=>presetPeriod('month')

export function previousPeriod(period:PeriodValue):PeriodValue {
  const start=parseISO(period.start),end=parseISO(period.end),days=Math.max(1,Math.round((end.getTime()-start.getTime())/86400000)+1)
  const previousEnd=subDays(start,1),previousStart=subDays(previousEnd,days-1)
  return {start:format(previousStart,'yyyy-MM-dd'),end:format(previousEnd,'yyyy-MM-dd'),label:'Período anterior'}
}
