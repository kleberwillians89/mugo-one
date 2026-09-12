import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const page=readFileSync('src/pages/ControlTowerPage.tsx','utf8')
const domain=readFileSync('src/lib/control-tower.ts','utf8')
const routing=readFileSync('src/routing.ts','utf8')
const migration=readFileSync('supabase/migrations/202609120003_role_scoped_tasks.sql','utf8')

describe('tarefas por responsabilidade e acesso',()=>{
 it('roteia tarefas por permissões próprias',()=>{for(const code of['tasks.sales','tasks.split','tasks.shipping','tasks.management'])expect(routing).toContain(code)})
 it('carrega somente os domínios permitidos',()=>{expect(domain).toContain('scope.sales?fetchSalesValidationQueue()');expect(domain).toContain('scope.split?fetchSplitStatusCards()');expect(domain).toContain('scope.shipping?fetchOperationalShipments()')})
 it('apresenta os responsáveis corretos',()=>{expect(page).toContain('title="Davi" subtitle="Vendas"');expect(page).toContain('title="Gabriel" subtitle="Splitar"');expect(page).toContain('title="Emily e Ilde" subtitle="Entregas"')})
 it('configura os presets e mantém o Gabriel antigo inativo',()=>{expect(migration).toContain("permission_preset='comercial'");expect(migration).toContain("permission_preset='entregas'");expect(migration).toContain("'tasks.split',true");expect(migration).toContain("status='inactive'")})
 it('preserva a conta mestre e valida identidades antes de alterar',()=>{expect(migration).toContain('task_role_identity_check_failed');expect(migration).not.toMatch(/update public\.organization_members[^;]+3f34fe2b/s)})
})
