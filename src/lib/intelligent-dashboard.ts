import { authenticatedOrganization } from './records'
import { supabase } from './supabase'

export type DashboardPeriodKey='last_hour'|'today'|'24h'|'7d'|'30d'|'custom'
export type DashboardMetrics={sales_count:number;items_sold:number;revenue:number|null;ml_sold:number;unique_perfumes:number;average_ticket:number|null;buyers:number;new_buyers:number;returning_buyers:number;paid_count:number;pending_count:number;unclassified_perfume_count:number}
export type DashboardAlert={type:string;severity:'critical'|'warning'|'info';entity_id:string;title:string;description:string;created_at:string}
export type DashboardProduct={perfume_id:string|null;name:string;items:number;ml:number;revenue:number|null;buyers:number}
export type DashboardRecentSale={id:string;client_name:string;sale_date:string;created_at:string;perfume_name:string;bottle_identifier:string|null;volume_ml:number|null;amount:number|null;payment_status:string;sale_type:string|null;separation_status:string|null;shipment_status:string|null}
export type IntelligentDashboard={
  generated_at:string;timezone:string;period:{key:DashboardPeriodKey;start:string;end:string;uses:'created_at'|'sale_date';commercial_dates:[string,string]}
  viewer:{profile:'management'|'finance'|'operations'|'commercial'|'marketing'|'viewer';preset:string;finance_allowed:boolean;operations_allowed:boolean;management_allowed:boolean}
  metrics:DashboardMetrics;previous_metrics:Pick<DashboardMetrics,'sales_count'|'revenue'|'ml_sold'|'buyers'|'average_ticket'>
  day_summary:{today:{sales_count:number;revenue:number|null;ml:number};yesterday:{sales_count:number;revenue:number|null;ml:number}}
  operations:{awaiting_separation:number;missing_allocations:number;paid_older_24h:number;pending_collection:number;shipments_open:number;awaiting_tracking:number;labels_pending:number;critical_stock:number}
  alerts:DashboardAlert[];top_products:DashboardProduct[];recent_sales:DashboardRecentSale[];definitions:Record<string,string>
}

export async function fetchIntelligentDashboard(period:DashboardPeriodKey,startDate?:string,endDate?:string){
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('dashboard_summary',{p_organization_id:organizationId,p_period:period,p_start_date:startDate??null,p_end_date:endDate??null})
  if(error)throw new Error(error.message)
  return data as IntelligentDashboard
}

export function percentChange(current:number,previous:number):number|null{
  if(!Number.isFinite(current)||!Number.isFinite(previous)||previous===0)return null
  return((current-previous)/Math.abs(previous))*100
}

export function buildDashboardNarrative(data:IntelligentDashboard):string{
  const m=data.metrics,o=data.operations
  if(!m.sales_count)return 'Ainda não há vendas neste período. Use os alertas operacionais para decidir a próxima ação.'
  const revenue=m.revenue==null?null:percentChange(m.revenue,Number(data.previous_metrics.revenue))
  const trend=revenue===null?'':`; a receita está ${Math.abs(revenue).toFixed(1)}% ${revenue>=0?'acima':'abaixo'} do período anterior`
  const priority=o.missing_allocations?`${o.missing_allocations} venda${o.missing_allocations===1?' paga está':'s pagas estão'} sem reserva de estoque`:o.awaiting_separation?`${o.awaiting_separation} venda${o.awaiting_separation===1?' aguarda':'s aguardam'} separação`:'nenhum bloqueio crítico foi identificado'
  return `${m.sales_count} itens comerciais somam ${m.ml_sold.toLocaleString('pt-BR')} ML${trend}. Agora, ${priority}.`
}
