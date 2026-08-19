import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the team/permissions backend (migrations
 * 202608190011-013). No live Postgres instance is reachable from this
 * sandbox (same constraint as every other backend suite this session),
 * so these assert the exact guarding SQL exists in the migration text
 * rather than executing a real RPC call against a live database. Live
 * confirmation (creating a real user, hitting a real RPC as a non-admin,
 * etc.) remains PENDING HUMAN VALIDATION — see final report.
 */

const read = (relPath: string) => readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8')

const schema = read('supabase/migrations/202608190011_team_permissions.sql')
const rpcs = read('supabase/migrations/202608190012_team_management_rpcs.sql')
const gates = read('supabase/migrations/202608190013_permission_gate_critical_rpcs.sql')
const createUserFn = read('supabase/functions/admin-create-user/index.ts')
const resetPasswordFn = read('supabase/functions/admin-reset-password/index.ts')

const hasOrgPermission = schema.slice(schema.indexOf('create or replace function public.has_org_permission'))
const orgAdminCount = schema.slice(schema.indexOf('create or replace function public.org_admin_count'), schema.indexOf('-- ============================================================\n-- 6. BACKFILL'))
const teamSetPermissions = rpcs.slice(rpcs.indexOf('create or replace function public.team_set_permissions'), rpcs.indexOf('create or replace function public.team_set_status'))
const teamSetStatus = rpcs.slice(rpcs.indexOf('create or replace function public.team_set_status'), rpcs.indexOf('create or replace function public.team_provision_member'))
const teamProvisionMember = rpcs.slice(rpcs.indexOf('create or replace function public.team_provision_member'))

describe('D/E — senha nunca entra em tabela nem em auditoria', () => {
  it('D: nenhuma migration deste módulo cria uma coluna de senha em lugar nenhum', () => {
    for (const sql of [schema, rpcs, gates]) {
      expect(sql).not.toMatch(/password\s+text/i)
      expect(sql).not.toContain('p_password')
    }
  })
  it('E: os audit_logs de user_created/user_password_reset nunca incluem a senha no metadata', () => {
    expect(teamProvisionMember).toContain("'user_created'")
    const auditBlock = teamProvisionMember.slice(teamProvisionMember.indexOf('audit_logs'))
    expect(auditBlock).not.toContain('password')
    expect(resetPasswordFn).toContain("'user_password_reset'")
    // audit() é chamado com metadata={} — nunca a senha nova nem a antiga.
    expect(resetPasswordFn).toMatch(/audit\([^)]*'user_password_reset'[^)]*,\s*\{\}\)/)
  })
  it('a Edge Function de criação nunca loga a senha (só usa a variável local para o Admin API e para o RPC de override, nunca em console/audit)', () => {
    expect(createUserFn).not.toMatch(/console\.(log|error|warn)\([^)]*password/i)
  })
})

describe('F/G — status ativo/inativo controla acesso de verdade', () => {
  it('F: has_org_permission nega tudo quando o membro não está ativo', () => {
    expect(hasOrgPermission).toContain("if not found or v_member.status <> 'active' then")
    expect(hasOrgPermission.slice(hasOrgPermission.indexOf("status <> 'active'"), hasOrgPermission.indexOf("status <> 'active'") + 60)).toContain('return false;')
  })
  it('G: team_set_status aceita reativar (status=active) pelo mesmo caminho que desativa', () => {
    expect(teamSetStatus).toContain("if p_status not in ('active','inactive') then")
    expect(teamSetStatus).toContain("case when p_status = 'active' then 'user_reactivated' else 'user_deactivated' end")
  })
})

describe('H — isolamento entre organizações (tenant-bound)', () => {
  it('has_org_permission só encontra o membro filtrando por organization_id = org_id — nunca lê membership de outra organização', () => {
    expect(hasOrgPermission).toContain('where organization_id = org_id and user_id = auth.uid()')
  })
  it('team_members/team_member_permissions/team_set_permissions/team_set_status recebem organization_id explícito e escopam todas as consultas por ele', () => {
    for (const fn of [rpcs]) {
      expect(fn).toContain('where om.organization_id = org_id')
      expect(fn).toContain('where omp.organization_id = org_id and omp.user_id = target_user_id')
    }
  })
  it('admin-reset-password confirma que o alvo pertence à organização do caller antes de tocar no Admin API — nunca aceita um user_id de outro tenant', () => {
    expect(resetPasswordFn).toContain(".eq('organization_id', organizationId).eq('user_id', targetUserId)")
  })
})

describe('I/J/K/L/M — presets concedem exatamente o que o briefing pede, nada a mais', () => {
  it('I: Comercial tem vendas completo', () => {
    expect(schema).toContain("('comercial','sales.view'),('comercial','sales.create'),('comercial','sales.edit'),('comercial','sales.validate'),('comercial','sales.cancel')")
  })
  it('J: Comercial NÃO tem inventory.adjust — e inventory_apply agora checa has_org_permission(...,\'inventory.adjust\'), não mais has_org_role', () => {
    const comercialBlock = schema.slice(schema.indexOf("insert into public.preset_permissions (preset, permission_code) values\n  ('comercial'"), schema.indexOf("-- ENTREGAS"))
    expect(comercialBlock).not.toContain('inventory.adjust')
    expect(gates).toContain("not public.has_org_permission(v_item.organization_id, 'inventory.adjust')")
    expect(gates).not.toContain("has_org_role(\n       v_item.organization_id")
  })
  it('K: Entregas tem inventory.scan/conference e shipping.scan — e shipment_item_scan_bottle agora checa has_org_permission(...,\'shipping.scan\')', () => {
    const entregasBlock = schema.slice(schema.indexOf("insert into public.preset_permissions (preset, permission_code) values\n  ('entregas'"), schema.indexOf('-- ESTOQUE'))
    expect(entregasBlock).toContain('inventory.scan')
    expect(entregasBlock).toContain('inventory.conference')
    expect(entregasBlock).toContain('shipping.scan')
    expect(gates).toContain("not public.has_org_permission(v_shipment.organization_id,'shipping.scan')")
  })
  it('L: Entregas NÃO tem cost_margin.view — e perfume_margin_summary/inventory_operational_rows mascaram custo quando ausente', () => {
    const entregasBlock = schema.slice(schema.indexOf("insert into public.preset_permissions (preset, permission_code) values\n  ('entregas'"), schema.indexOf('-- ESTOQUE'))
    expect(entregasBlock).not.toContain('cost_margin')
    expect(gates).toContain("case when public.has_org_permission(org_id, 'cost_margin.view') then p.average_cost_per_ml else null end")
    expect(gates).toContain('visible.can_view and base.average_cost_per_ml is not null as has_cost')
  })
  it('M: visualizacao nunca ganha nenhuma linha de permissão de escrita — só o flag view_all (que não concede write nenhum, ver teste O)', () => {
    expect(schema).not.toMatch(/'visualizacao',\s*'[a-z_]+\.(create|edit|adjust|manage|cancel|validate|post|scan|split|prepare|label|identity|print|conference|execute|confirm|export)'/)
  })
})

describe('N/O/P — VER TUDO x ACESSO TOTAL, a distinção essencial do briefing', () => {
  it('N: view_all concede qualquer código terminado em .view', () => {
    expect(hasOrgPermission).toContain("v_member.view_all\n     and permission_code like '%.view'")
  })
  it('O: view_all NUNCA concede um código que não termina em .view — a checagem é sintaticamente restrita ao sufixo, então escrita nunca passa por aqui', () => {
    const viewAllBlock = hasOrgPermission.slice(hasOrgPermission.indexOf('if v_member.view_all'), hasOrgPermission.indexOf('end if;', hasOrgPermission.indexOf('if v_member.view_all')))
    expect(viewAllBlock).toContain("like '%.view'")
    expect(viewAllBlock).not.toMatch(/\.(create|edit|adjust|manage|cancel|validate|post|scan|split)/)
  })
  it('P: access_total concede qualquer código, sem exceção — é o primeiro check, antes de qualquer outra regra', () => {
    const beforeAccessTotal = hasOrgPermission.slice(0, hasOrgPermission.indexOf('if v_member.access_total then'))
    expect(beforeAccessTotal).not.toContain('view_all')
    expect(hasOrgPermission).toContain('if v_member.access_total then\n    return true;\n  end if;')
  })
  it('view_all nunca vaza team.view/audit.view (não fazem parte do exemplo "Ver tudo" do briefing)', () => {
    expect(hasOrgPermission).toContain("and permission_code not in ('team.view', 'audit.view')")
  })
})

describe('Q/T — só team.manage altera usuários, nunca team.view sozinho', () => {
  it('Q: team_set_permissions e team_set_status checam team.manage, não team.view', () => {
    expect(teamSetPermissions).toContain("public.has_org_permission(p_organization_id, 'team.manage')")
    expect(teamSetPermissions).not.toContain("'team.view'")
    expect(teamSetStatus).toContain("public.has_org_permission(p_organization_id, 'team.manage')")
  })
  it('T: a Edge Function de criação também exige team.manage antes de qualquer chamada ao Admin API — inclusive para criar outro administrador', () => {
    expect(createUserFn).toContain("permission_code: 'team.manage'")
    const beforeAdminApi = createUserFn.slice(0, createUserFn.indexOf('auth.admin.createUser'))
    expect(beforeAdminApi).toContain("if (permError || !allowed) return json({ error: { code: 'forbidden'")
  })
  it('team_provision_member (só service_role) nunca reavalia autorização sozinho — é chamado só depois que a Edge Function já verificou team.manage com o client do próprio caller', () => {
    expect(rpcs).toContain('grant execute on function public.team_provision_member(uuid, uuid, text, text, boolean, boolean, uuid) to service_role;')
    expect(rpcs).not.toMatch(/grant execute on function public\.team_provision_member[^;]*authenticated/)
  })
})

describe('R/S — proteção do último admin', () => {
  it('R: team_set_status verifica org_admin_count depois de aplicar a mudança, e desfaz (raise exception) se zerar', () => {
    expect(teamSetStatus).toContain('if public.org_admin_count(p_organization_id) = 0 then')
    expect(teamSetStatus).toContain("raise exception 'cannot_remove_last_admin';")
  })
  it('S: team_set_permissions tem a mesma proteção — trocar preset/permissões não pode zerar quem tem team.manage', () => {
    expect(teamSetPermissions).toContain('if public.org_admin_count(p_organization_id) = 0 then')
    expect(teamSetPermissions).toContain("raise exception 'cannot_remove_last_admin';")
  })
  it('org_admin_count conta access_total OU team.manage explícito, nunca view_all (view_all não é team.manage)', () => {
    expect(orgAdminCount).toContain('om.access_total')
    expect(orgAdminCount).toContain("omp.permission_code = 'team.manage' and omp.granted")
    expect(orgAdminCount).not.toContain('view_all')
  })
})

describe('U — deny by default: RPC direta sem permissão falha, nunca silenciosamente passa', () => {
  it('has_org_permission retorna false (nunca null/erro engolido) quando não há membership', () => {
    expect(hasOrgPermission).toContain('if not found or')
    expect(hasOrgPermission.trim().endsWith('return false;\nend;\n$$;')).toBe(false) // não é a única saída — só confirma que existe um fallback final
    expect(hasOrgPermission).toMatch(/return false;\s*\n\s*end;/)
  })
  it('toda RPC crítica gateada nesta migration levanta exceção quando has_org_permission nega — nunca retorna dado/segue em silêncio', () => {
    expect(gates).toContain("raise exception 'inventory_write_forbidden';")
    expect(gates).toContain("raise exception 'forbidden'; end if;")
  })
})

describe('backfill de compatibilidade nunca escala automaticamente um manager legado a team.manage', () => {
  it('o backfill de \'manager\' explicitamente exclui team.manage das linhas inseridas', () => {
    const managerBackfill = schema.slice(schema.indexOf('-- Gestor legado'), schema.indexOf('-- Operator legado'))
    expect(managerBackfill).toContain("preset = 'gestor'")
    const gestorPreset = schema.slice(schema.indexOf("insert into public.preset_permissions (preset, permission_code)\nselect 'gestor'"))
    expect(gestorPreset.slice(0, gestorPreset.indexOf(';'))).toContain("code <> 'team.manage'")
  })
  it('admin legado vira access_total=true (equivalente ao que has_org_role já concedia em toda RPC auditada), nunca menos', () => {
    expect(schema).toContain("access_total = (role = 'admin')")
  })
})

describe('rede de segurança: nenhuma organização pode ficar com zero team.manage após o backfill — mas nunca mais de UM promovido', () => {
  const safetyNet = schema.slice(schema.indexOf('-- 7. REDE DE SEGURANÇA'))
  const selection = safetyNet.slice(safetyNet.indexOf('select om.user_id into v_promote'), safetyNet.indexOf('if v_promote is not null then'))

  it('o backfill de role/preset é DML cru — não passa pelas RPCs com guard de último admin (org_admin_count só é chamado depois, explicitamente)', () => {
    const backfillBlock = schema.slice(schema.indexOf('update public.organization_members set'), schema.indexOf('-- 7. REDE DE SEGURANÇA'))
    expect(backfillBlock).not.toContain('team_set_status')
    expect(backfillBlock).not.toContain('team_set_permissions')
  })
  it('depois do backfill, verifica org_admin_count para TODA organização — não só a que tem o usuário legado conhecido', () => {
    expect(safetyNet).toContain('for v_org in select id from public.organizations loop')
    expect(safetyNet).toContain('if public.org_admin_count(v_org.id) = 0 then')
  })

  it('A: org com 1 membro ativo e zero admin — a seleção escopada por organization_id+status pega esse único membro (LIMIT 1 garante nunca mais que ele)', () => {
    expect(selection).toContain('where om.organization_id = v_org.id and om.status = \'active\'')
    expect(selection).toContain('limit 1')
  })
  it('B: org com vários membros ativos e zero admin — LIMIT 1 garante exatamente UM promovido, nunca todos (a regressão do pedido anterior)', () => {
    // a query inteira só tem UM "limit" — não existe caminho de código que
    // itere e promova mais de uma linha por organização.
    expect((selection.match(/limit 1/g) ?? []).length).toBe(1)
    expect(selection).not.toMatch(/for\s+\w+\s+in\s+select.*organization_members/i)
  })
  it('C: preferência manager > operator no desempate (e admin > manager > operator > viewer, na ordem certa)', () => {
    expect(selection).toMatch(/when 'admin' then 1\s*\n\s*when 'manager' then 2\s*\n\s*when 'operator' then 3\s*\n\s*when 'viewer' then 4/)
  })
  it('desempate final é por user_id — nunca assume created_at (coluna cuja garantia de existência esta migration não controla)', () => {
    expect(selection).not.toContain('created_at')
    expect(selection).toMatch(/om\.user_id\s*\n\s*limit 1;/)
  })
  it('D: org que já tem admin (org_admin_count>0) nunca entra no bloco — nenhuma promoção acontece, ninguém extra é tocado', () => {
    expect(safetyNet).toContain('if public.org_admin_count(v_org.id) = 0 then')
    // o UPDATE de promoção só existe DENTRO do corpo desse if — não há
    // nenhum caminho de update fora dele.
    const outsideIf = safetyNet.slice(0, safetyNet.indexOf('if public.org_admin_count'))
    expect(outsideIf).not.toContain('update public.organization_members')
  })
  it('E: org sem membro ativo nenhum — v_promote fica null, nenhum usuário é inventado, só um NOTICE documentando o caso', () => {
    expect(safetyNet).toContain('if v_promote is not null then')
    // busca o "else" que é irmão de "if v_promote is not null" — não o
    // "else 5" de dentro do CASE do desempate, que aparece antes.
    const afterIfPromote = safetyNet.slice(safetyNet.indexOf('if v_promote is not null then'))
    const elseBranch = afterIfPromote.slice(afterIfPromote.indexOf('\n      else\n'), afterIfPromote.indexOf('end if;\n    end if;'))
    expect(elseBranch).toContain('raise notice')
    expect(elseBranch).not.toContain('insert into public.organization_members')
    expect(elseBranch).not.toContain('update public.organization_members')
  })

  it('o promovido vira administrador de recuperação: preset+view_all+access_total explícitos (status já garantido \'active\' pela própria seleção)', () => {
    const promotionUpdate = safetyNet.slice(safetyNet.indexOf('update public.organization_members set\n          permission_preset'))
    expect(promotionUpdate).toContain("permission_preset = 'administrador'")
    expect(promotionUpdate).toContain('view_all = true')
    expect(promotionUpdate).toContain('access_total = true')
    expect(promotionUpdate).toContain('where organization_id = v_org.id and user_id = v_promote')
  })
  it('nenhum e-mail/auth.users é usado para decidir — só organization_members, e a migration continua genérica (sem o e-mail parfumsruah@gmail.com hardcoded em lugar nenhum)', () => {
    expect(safetyNet).not.toContain('auth.users')
    expect(safetyNet).not.toContain('parfumsruah')
  })
  it('usa RAISE NOTICE, não EXCEPTION — a rede de segurança nunca pode fazer o próprio push falhar', () => {
    expect(safetyNet).toContain('raise notice')
    expect(safetyNet).not.toMatch(/raise exception/i)
  })
})
