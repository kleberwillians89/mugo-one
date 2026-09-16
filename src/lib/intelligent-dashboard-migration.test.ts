import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const sql=readFileSync(new URL('../../supabase/migrations/202609160001_intelligent_dashboard.sql',import.meta.url),'utf8')
const entrypoint=readFileSync(new URL('../../supabase/migrations/202609160004_dashboard_authenticated_entrypoint.sql',import.meta.url),'utf8')
describe('dashboard_summary: contrato, autorização e isolamento',()=>{
  it('nega por padrão e exige dashboard.view',()=>{expect(sql).toContain("has_org_permission(p_organization_id,'dashboard.view')");expect(sql).toContain("raise exception 'organization_access_denied'")})
  it('torna a Home acessível aos membros ativos sem ampliar outros módulos',()=>{expect(sql).toContain("om.status='active'");expect(sql).toContain("'dashboard.view',true")})
  it('escopa todas as fontes operacionais pela organização',()=>{for(const table of ['public.sales s','public.shipments h','public.replenishment_signals(p_organization_id)'])expect(sql).toContain(table);expect(sql).toContain('s.organization_id=p_organization_id')})
  it('centraliza alertas no RPC e mantém formato genérico',()=>{for(const field of ['type','severity','entity_id','title','description','created_at'])expect(sql).toContain(field)})
  it('diferencia timestamp horário de data comercial',()=>{expect(sql).toContain("v_hourly then s.created_at>=v_start_ts");expect(sql).toContain('s.sale_date between v_start_date and v_end_date')})
  it('adiciona índices compatíveis com os filtros principais',()=>{expect(sql).toContain('sales_org_created_active_idx');expect(sql).toContain('shipments_org_status_created_idx')})
  it('não retorna valores financeiros sem permissão',()=>{expect(sql).toContain('case when v_finance then s.amount else null end amount');expect(sql).toContain("'revenue',case when v_finance")})
})

describe('dashboard_home_summary: entrada autenticada do PostgREST',()=>{
  it('resolve o tenant pela sessão e não recebe organization_id do frontend',()=>{expect(entrypoint).toContain('om.user_id=auth.uid()');expect(entrypoint).not.toContain('p_organization_id uuid')})
  it('é concedida ao papel authenticated e validada usando esse mesmo papel',()=>{expect(entrypoint).toContain('to authenticated,service_role');expect(entrypoint).toContain('set local role authenticated')})
  it('força a atualização do schema cache do PostgREST',()=>{expect(entrypoint).toContain("notify pgrst,'reload schema'")})
})
