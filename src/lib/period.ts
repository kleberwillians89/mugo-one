import { format, parseISO, subDays } from 'date-fns'
import { OPERATIONAL_START_DATE, operationalStartDate } from './operational-sales'

export type PeriodValue = { start:string; end:string; label:string }
export type PeriodPreset = 'today'|'yesterday'|'7d'|'30d'|'month'|'previous_month'|'quarter'|'year'|'operational'|'all'|'custom'
const localIso = (date:Date) => format(date,'yyyy-MM-dd')

// 'operational' resolve para organizations.operational_sales_start_date (ver
// operational_sales_floor no banco) — quem chama passa essa data já
// carregada (PermissionsContext). O fallback central da RUAH impede que uma
// falha/ausência transitória da configuração exponha o acervo histórico.
export function presetPeriod(preset:PeriodPreset,now=new Date(),operationalStart?:string|null):PeriodValue {
  const end=new Date(now),start=new Date(now)
  start.setHours(12,0,0,0);end.setHours(12,0,0,0)
  const labels:Record<PeriodPreset,string>={today:'Hoje',yesterday:'Ontem','7d':'Últimos 7 dias','30d':'Últimos 30 dias',month:'Este mês',previous_month:'Mês anterior',quarter:'Este trimestre',year:'Este ano',operational:'Operação atual',all:'Todo o período',custom:'Período personalizado'}
  if(preset==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1)}
  if(preset==='7d')start.setDate(start.getDate()-6)
  if(preset==='30d')start.setDate(start.getDate()-29)
  if(preset==='month')start.setDate(1)
  if(preset==='previous_month'){start.setMonth(start.getMonth()-1,1);end.setDate(0)}
  if(preset==='quarter')start.setMonth(Math.floor(start.getMonth()/3)*3,1)
  if(preset==='year')start.setMonth(0,1)
  if(preset==='all'){start.setFullYear(1900,0,1);end.setFullYear(2100,11,31)}
  if(preset==='operational'){
    const[year,month,day]=operationalStartDate(operationalStart).split('-').map(Number);start.setFullYear(year,month-1,day)
  }
  return {start:localIso(start),end:localIso(end),label:labels[preset]}
}
export const defaultPeriod=()=>presetPeriod('operational',new Date(),OPERATIONAL_START_DATE)

// ===== Boot do período (App.tsx) =====
// Estado-máquina puro e testável para uma única garantia: NENHUMA página que
// depende de período (Dashboard/Vendas/Entregas/...) pode montar — e
// portanto nenhum fetch pode disparar — antes de saber se a organização tem
// operational_sales_start_date. `ready` só vira true DEPOIS de resolvido, e
// já chega com o período correto (operacional, ou todo o histórico se a
// organização não tiver corte) — nunca em duas etapas.
export const PERIOD_SYNC_PENDING='__pending__' as const
export type BootPeriodState={ready:boolean;period:PeriodValue;syncedFor:string|null|typeof PERIOD_SYNC_PENDING}
export const initialBootPeriodState=(fallback:PeriodValue):BootPeriodState=>({ready:false,period:fallback,syncedFor:PERIOD_SYNC_PENDING})

export function advanceBootPeriod(state:BootPeriodState,permissionsLoading:boolean,operationalSalesStartDate:string|null,now?:Date):BootPeriodState{
  if(permissionsLoading)return state.ready?{...state,ready:false}:state
  if(state.syncedFor!==PERIOD_SYNC_PENDING)return state.ready?state:{...state,ready:true}
  return{ready:true,period:presetPeriod('operational',now,operationalSalesStartDate),syncedFor:operationalSalesStartDate}
}

export function previousPeriod(period:PeriodValue):PeriodValue {
  const start=parseISO(period.start),end=parseISO(period.end),days=Math.max(1,Math.round((end.getTime()-start.getTime())/86400000)+1)
  const previousEnd=subDays(start,1),previousStart=subDays(previousEnd,days-1)
  return {start:format(previousStart,'yyyy-MM-dd'),end:format(previousEnd,'yyyy-MM-dd'),label:'Período anterior'}
}
