import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the real production 42501 (insufficient_privilege)
 * from Edge Function logs: superfrete-sync-shipment's print_health_persist
 * stage did a DIRECT `.from('shipments').update(...)` using the caller's
 * JWT (ctx.client = anon key + Authorization header → Postgres role
 * "authenticated"). 202608130001_operational_foundation and
 * 202608140001_final_operational_pass both explicitly REVOKE
 * insert/update/delete on public.shipments from "authenticated" — every
 * other write to this table in the whole project goes through a
 * SECURITY DEFINER RPC. This was the one direct-write exception (two
 * occurrences in the same file, both fixed the same way). No live
 * Postgres/Edge Function runtime is reachable from this sandbox, so this
 * is verified by source-text assertion, same convention as the rest of
 * this session's SQL-migration test coverage.
 */

const migration = readFileSync(new URL('../../supabase/migrations/202608190015_shipment_print_health_rpc.sql', import.meta.url), 'utf8')
const foundation = readFileSync(new URL('../../supabase/migrations/202608130001_operational_foundation.sql', import.meta.url), 'utf8')
const finalPass = readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql', import.meta.url), 'utf8')
const permissionsMigration = readFileSync(new URL('../../supabase/migrations/202608190011_team_permissions.sql', import.meta.url), 'utf8')
const indexTs = readFileSync(new URL('../../supabase/functions/superfrete-sync-shipment/index.ts', import.meta.url), 'utf8')

describe('confirma a causa raiz do 42501: GRANT revogado, não RLS que falhou', () => {
  it('a fundação operacional revoga insert/update/delete em shipments de "authenticated" — a mesma role que o Edge Function usa (JWT do caller, não service_role)', () => {
    expect(foundation).toContain('revoke insert,update,delete on public.shipments from authenticated;')
  })
  it('reafirmado depois, explicitamente para nunca mais haver update direto', () => {
    expect(finalPass).toContain('revoke insert,update,delete on public.shipments from authenticated;')
    expect(finalPass).toContain('nunca por update direto')
  })
})

describe('a nova RPC shipment_set_superfrete_print_health segue o mesmo padrão de toda outra escrita em shipments', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.shipment_set_superfrete_print_health'), migration.indexOf('create or replace function public.shipment_mark_superfrete_pending_conference'))
  it('é security definer, com search_path fixo (mesmo padrão de post_shipment/apply_superfrete_state)', () => {
    expect(fn).toContain('security definer')
    expect(fn).toContain('set search_path = public')
  })
  it('usa has_org_permission com shipping.label — não team.manage, não um shortcut de access_total isolado', () => {
    expect(fn).toContain("public.has_org_permission(v.organization_id, 'shipping.label')")
    expect(fn).not.toContain('team.manage')
  })
  it('a organização vem da PRÓPRIA linha do shipment (select ... where id=p_shipment_id), nunca de um parâmetro externo — isolamento de tenant estrutural, não dependente do caller mandar o org_id certo', () => {
    expect(fn).not.toMatch(/p_organization_id/)
    expect(fn).toContain('select * into v from public.shipments where id = p_shipment_id for update')
  })
  it('escreve SOMENTE os 7 campos técnicos de saúde de impressão — nunca recipient, tracking, estoque, physical source ou status operacional', () => {
    const updateBlock = fn.slice(fn.indexOf('update public.shipments set'), fn.indexOf('where id = v.id'))
    expect(updateBlock).toContain('print_url')
    expect(updateBlock).toContain('label_pdf_url')
    expect(updateBlock).toContain('print_available')
    expect(updateBlock).toContain('print_http_status')
    expect(updateBlock).toContain('print_content_type')
    expect(updateBlock).toContain('print_checked_at')
    expect(updateBlock).toContain('integration_error')
    for (const forbidden of ['recipient_', 'tracking_code', 'physical_ml', 'available_ml', ' status =', 'superfrete_order_id', 'sale_id', 'allocation']) {
      expect(updateBlock).not.toContain(forbidden)
    }
  })
  it('não aceita nenhum parâmetro fora do escopo de impressão (recipient/estoque/tracking/status/order id arbitrário)', () => {
    const signature = fn.slice(fn.indexOf('shipment_set_superfrete_print_health('), fn.indexOf(') returns public.shipments'))
    for (const forbidden of ['p_recipient', 'p_physical_ml', 'p_available_ml', 'p_tracking_code', 'p_superfrete_order_id', 'p_sale_id', 'p_allocation_id']) {
      expect(signature).not.toContain(forbidden)
    }
  })
})

describe('a segunda ocorrência do mesmo bug (ramo physical_conference_pending) tem sua própria RPC igualmente estreita', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.shipment_mark_superfrete_pending_conference'))
  it('também exige shipping.label e também deriva a organização da própria linha', () => {
    expect(fn).toContain("public.has_org_permission(v.organization_id, 'shipping.label')")
    expect(fn).not.toMatch(/p_organization_id/)
  })
  it('só marca o código operacional fixo PHYSICAL_CONFERENCE_PENDING — não aceita texto livre para integration_error', () => {
    expect(fn).toContain("integration_error = 'PHYSICAL_CONFERENCE_PENDING'")
    expect(fn).not.toContain('p_integration_error')
  })
})

describe('shipping.label já existe no catálogo — nenhum código de permissão novo foi inventado', () => {
  it('está definido no catálogo com o módulo e rótulo corretos', () => {
    expect(permissionsMigration).toContain("('shipping.label','shipping','Gerenciar etiqueta de envio'")
  })
  it('já é concedido ao preset "entregas" (logística) — usuário de logística com esse preset passa', () => {
    expect(permissionsMigration).toContain("('entregas','shipping.view'),('entregas','shipping.prepare'),('entregas','shipping.scan'),('entregas','shipping.label'),('entregas','shipping.post')")
  })
  it('has_org_permission (autoridade única) já concede tudo automaticamente para access_total=true — administrador passa sem precisar de shipping.label explícito', () => {
    const fnBlock = permissionsMigration.slice(permissionsMigration.indexOf('create or replace function public.has_org_permission'), permissionsMigration.indexOf('grant execute on function public.has_org_permission'))
    expect(fnBlock).toContain('if v_member.access_total then')
    expect(fnBlock).toContain('return true;')
  })
})

describe('o Edge Function não faz mais nenhum write direto em shipments — as duas ocorrências viraram chamadas de RPC', () => {
  it('nenhum .from(\'shipments\').update( sobrevive no arquivo', () => {
    expect(indexTs).not.toContain(".from('shipments').update(")
  })
  it('a etapa 3 (saúde de impressão) chama a nova RPC estreita', () => {
    expect(indexTs).toContain("ctx.client.rpc('shipment_set_superfrete_print_health'")
  })
  it('o ramo physical_source_not_confirmed também chama sua RPC estreita, não mais um update direto', () => {
    expect(indexTs).toContain("ctx.client.rpc('shipment_mark_superfrete_pending_conference'")
  })
})

describe('service_role nunca foi usado como atalho — o modelo continua JWT do caller + RPC autorizada', () => {
  it('a Edge Function não referencia SUPABASE_SERVICE_ROLE_KEY em lugar nenhum', () => {
    expect(indexTs).not.toContain('SERVICE_ROLE')
  })
  it('ctx.client (usado em todas as etapas, incluindo as novas chamadas de RPC) é sempre o client autenticado pelo JWT do chamador — nunca trocado por um client administrativo', () => {
    expect(indexTs.match(/await ctx\.client\.rpc\(/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
