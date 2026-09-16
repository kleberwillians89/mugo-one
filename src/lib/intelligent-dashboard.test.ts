import {describe,expect,it} from 'vitest'
import {buildDashboardNarrative,IntelligentDashboard,percentChange} from './intelligent-dashboard'

const fixture: IntelligentDashboard={
  generated_at:'2026-09-16T12:00:00Z',timezone:'America/Sao_Paulo',period:{key:'today',start:'2026-09-16T03:00:00Z',end:'2026-09-17T03:00:00Z',uses:'sale_date',commercial_dates:['2026-09-16','2026-09-16']},
  viewer:{profile:'operations',preset:'entregas',finance_allowed:false,operations_allowed:true,management_allowed:false},
  metrics:{sales_count:3,items_sold:3,revenue:300,ml_sold:18,unique_perfumes:2,average_ticket:100,buyers:2,new_buyers:1,returning_buyers:1,paid_count:2,pending_count:1,unclassified_perfume_count:0},
  previous_metrics:{sales_count:2,revenue:200,ml_sold:12,buyers:2,average_ticket:100},day_summary:{today:{sales_count:3,revenue:300,ml:18},yesterday:{sales_count:2,revenue:200,ml:12}},
  operations:{awaiting_separation:1,missing_allocations:0,paid_older_24h:0,pending_collection:1,shipments_open:1,awaiting_tracking:0,labels_pending:0,critical_stock:0},alerts:[],top_products:[],recent_sales:[],definitions:{},
}

describe('Home inteligente: narrativa sobre agregados determinísticos',()=>{
  it('calcula comparação sem dividir por zero',()=>{expect(percentChange(300,200)).toBe(50);expect(percentChange(1,0)).toBeNull()})
  it('narra somente números fornecidos pelo backend',()=>{expect(buildDashboardNarrative(fixture)).toBe('3 itens comerciais somam 18 ML; a receita está 50.0% acima do período anterior. Agora, 1 venda aguarda separação.')})
  it('não inventa resultado quando o período está vazio',()=>{expect(buildDashboardNarrative({...fixture,metrics:{...fixture.metrics,sales_count:0}})).toContain('não há vendas')})
})
