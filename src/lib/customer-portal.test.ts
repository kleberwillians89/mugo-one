import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the "Minha RUAH" customer portal. No live Postgres/
 * Edge Function runtime reachable from this sandbox (same constraint as
 * the rest of this session) — verified via source-text assertion against
 * the migrations/edge functions/frontend, same convention used throughout
 * (see superfrete-*.test.ts, team-frontend.test.ts). Letters A-AF map to
 * the exact test list from the briefing.
 */

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
const foundation = read('../supabase/migrations/202608200001_customer_portal.sql')
const staff = read('../supabase/migrations/202608200002_customer_portal_staff.sql')
const claim = read('../supabase/migrations/202608200003_customer_account_claim.sql')
const claimStartFn = read('../supabase/functions/customer-claim-start/index.ts')
const resolveLoginFn = read('../supabase/functions/customer-resolve-login/index.ts')
const accountInviteFn = read('../supabase/functions/customer-account-invite/index.ts')
const portalRoot = read('portal/CustomerPortalRoot.tsx')
const portalApp = read('portal/CustomerPortalApp.tsx')
const portalCss = read('portal/customer-portal.css')
const portalLib = read('lib/customer-portal.ts')

describe('A/B/C — primeiro acesso nunca permite enumeração de CPF', () => {
  it('A: customer-claim-start busca por normalized_cpf + e-mail e dispara o convite nativo do Supabase Auth quando bate', () => {
    expect(claimStartFn).toContain("eq('normalized_cpf', cpf)")
    expect(claimStartFn).toContain('ilike(\'email\', email)')
    expect(claimStartFn).toContain('admin.auth.admin.inviteUserByEmail(email')
  })
  it('B/C: toda saída da função usa a MESMA constante genérica — CPF inexistente, e-mail errado, e já ativo são indistinguíveis', () => {
    const genericOccurrences = claimStartFn.match(/json\(generic, 200, req\)/g) ?? []
    // cada early-return (não bateu, já ativo, throttle) devolve a mesma
    // referência de objeto — nunca uma mensagem diferente por caminho.
    expect(genericOccurrences.length).toBeGreaterThanOrEqual(4)
    expect(claimStartFn).not.toMatch(/cpf_not_found|email_mismatch|already_registered/i)
  })
  it('login por CPF também nunca revela existência: CPF sem conta ativa devolve o MESMO placeholder que qualquer CPF inválido', () => {
    const placeholderOccurrences = resolveLoginFn.match(/PLACEHOLDER_EMAIL/g) ?? []
    expect(placeholderOccurrences.length).toBeGreaterThanOrEqual(3)
  })
})

describe('D — nenhuma senha é armazenada em tabela própria', () => {
  it('client_accounts não tem coluna de senha/hash de senha — Supabase Auth é a única autoridade', () => {
    const table = foundation.slice(foundation.indexOf('create table public.client_accounts'), foundation.indexOf('create unique index client_accounts_client_uidx'))
    expect(table).not.toMatch(/password/i)
  })
  it('nenhuma Edge Function do portal loga ou retorna uma senha', () => {
    for (const src of [claimStartFn, resolveLoginFn, accountInviteFn]) {
      expect(src).not.toMatch(/console\.(log|error)\([^)]*password/i)
      expect(src).not.toContain('password:')
    }
  })
})

describe('E/F/G — isolamento entre clientes; cliente nunca é organization_member', () => {
  it('F: nenhuma migration do portal insere em organization_members', () => {
    for (const sql of [foundation, staff, claim]) expect(sql).not.toContain('into public.organization_members')
  })
  it('E/G: toda RPC "customer_*" de leitura/escrita resolve o client_id do PRÓPRIO chamador via current_customer_client() — nunca aceita client_id como parâmetro do navegador', () => {
    for (const fn of ['customer_custody', 'customer_shipment_requests_list', 'customer_purchase_history', 'customer_delivery_history', 'customer_profile', 'customer_support_tickets_list']) {
      const start = foundation.indexOf(`create or replace function public.${fn}(`)
      expect(start).toBeGreaterThan(-1)
      const body = foundation.slice(start, foundation.indexOf('$$;', start))
      expect(body).toContain('current_customer_client()')
      expect(body).not.toMatch(/p_client_id/)
    }
  })
  it('current_customer_client() nunca aceita parâmetro — só resolve auth.uid() do chamador', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.current_customer_client'), foundation.indexOf('grant execute on function public.current_customer_client'))
    expect(fn).toContain('current_customer_client()')
    expect(fn).toContain('auth_user_id = auth.uid()')
    expect(fn).not.toMatch(/\(p_/)
  })
})

describe('H/I — estoque livre para venda nunca aparece; custódia solicitada não fica vendável de novo', () => {
  it('H: customer_custody() só lê inventory_allocations (status reserved) — nunca inventory_items.available_ml', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_custody'), foundation.indexOf('grant execute on function public.customer_custody'))
    expect(fn).toContain("a.status = 'reserved'")
    expect(fn).not.toContain('inventory_items')
    expect(fn).not.toContain('available_ml')
  })
  it('I: criar uma solicitação NUNCA atualiza inventory_allocations — a allocation permanece reserved até a conversão real (equipe)', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_shipment_request_create'), foundation.indexOf('grant execute on function public.customer_shipment_request_create'))
    expect(fn).not.toMatch(/update public\.inventory_allocations/)
  })
})

describe('J/K — concorrência: nunca solicita o mesmo ml duas vezes; duplo clique não duplica', () => {
  it('trava as allocations (for update) e conta de novo antes de aceitar — mesmo idioma de create_draft_shipment', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_shipment_request_create'), foundation.indexOf('grant execute on function public.customer_shipment_request_create'))
    expect(fn).toContain("status = 'reserved' for update")
    expect(fn).toContain('v_count <> cardinality(p_allocation_ids)')
  })
  it('rejeita qualquer allocation já referenciada por uma solicitação ativa (não cancelada) antes de inserir — bloqueia duplo pedido e duplo clique na mesma transação', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_shipment_request_create'), foundation.indexOf('grant execute on function public.customer_shipment_request_create'))
    expect(fn).toContain("r.status <> 'cancelled'")
    expect(fn).toContain("raise exception 'already_requested'")
  })
})

describe('L/M/N/O/P — nenhuma etapa do portal baixa estoque físico; post_shipment continua a única baixa', () => {
  it('L: customer_shipment_request_create nunca escreve physical_ml/available_ml', () => {
    expect(foundation).not.toMatch(/physical_ml\s*=/)
    expect(foundation).not.toMatch(/available_ml\s*=/)
  })
  it('M/N: criar o shipment (cotar) e confirmar (cliente aceita o frete) também nunca tocam physical_ml/available_ml', () => {
    for (const sql of [staff]) { expect(sql).not.toMatch(/physical_ml\s*=/); expect(sql).not.toMatch(/available_ml\s*=/) }
    const confirmFn = foundation.slice(foundation.indexOf('create or replace function public.customer_shipment_request_confirm'), foundation.indexOf('grant execute on function public.customer_shipment_request_confirm'))
    expect(confirmFn).not.toMatch(/physical_ml|available_ml/)
  })
  it('O/P: post_shipment (única baixa física) não foi tocado por nenhuma migration nova do portal', () => {
    for (const sql of [foundation, staff, claim]) expect(sql).not.toMatch(/create or replace function public\.post_shipment/)
  })
})

describe('Q/R — endereço vem de um snapshot, nunca do cadastro ao vivo', () => {
  it('a criação da solicitação exige um endereço completo e grava address_snapshot (jsonb) na própria linha', () => {
    const table = foundation.slice(foundation.indexOf('create table public.customer_shipment_requests'), foundation.indexOf('create index customer_shipment_requests_org_idx'))
    expect(table).toContain('address_snapshot jsonb not null')
  })
  it('a conversão para shipment real usa addr := v_request.address_snapshot — nunca lê postal_code/address_line direto de clients', () => {
    const fn = staff.slice(staff.indexOf('create or replace function public.create_draft_shipment_from_customer_request'), staff.indexOf('create or replace function public.customer_shipment_requests_queue'))
    expect(fn).toContain('addr := v_request.address_snapshot')
    expect(fn).toContain("addr->>'postal_code'")
    expect(fn).not.toContain('v_client.postal_code')
  })
})

describe('S/T — tarefa para a equipe, sem usuário hardcoded', () => {
  it('S: entity_type de task_assignments passa a aceitar customer_shipment_request/customer_support_ticket', () => {
    expect(foundation).toContain("'customer_shipment_request'")
    expect(foundation).toContain("'customer_support_ticket'")
  })
  it('T: nenhuma migration/edge function/frontend do portal cita um nome de pessoa ou e-mail real fixo (reivindicar continua sendo auth.uid() do chamador, via task_assign já existente)', () => {
    for (const src of [foundation, staff, claim, claimStartFn, accountInviteFn, resolveLoginFn, portalRoot, portalApp]) {
      expect(src).not.toMatch(/emily|@gmail\.com|@hotmail\.com/i)
    }
  })
})

describe('U/V/W — cotar é só leitura, nunca compra; conversão nunca cria dois shipments', () => {
  it('U/V: create_draft_shipment_from_customer_request nunca chama /cart, /checkout, claim_superfrete_cart ou claim_superfrete_checkout', () => {
    const fn = staff.slice(staff.indexOf('create or replace function public.create_draft_shipment_from_customer_request'), staff.indexOf('create or replace function public.customer_shipment_requests_queue'))
    expect(fn).not.toMatch(/cart|checkout|superfrete/i)
  })
  it('W: só converte quando status ainda é "requested" — uma segunda tentativa na mesma solicitação já convertida é rejeitada, nunca cria um segundo shipment', () => {
    const fn = staff.slice(staff.indexOf('create or replace function public.create_draft_shipment_from_customer_request'), staff.indexOf('create or replace function public.customer_shipment_requests_queue'))
    expect(fn).toContain("if v_request.status <> 'requested' then raise exception 'request_not_pending'")
  })
})

describe('X/Y/Z/AA — rastreio e tickets escopados; anexos com RLS de posse', () => {
  it('X: customer_shipment_requests_list junta shipments só pelo converted_shipment_id da PRÓPRIA solicitação (já filtrada por current_customer_client)', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_shipment_requests_list'), foundation.indexOf('grant execute on function public.customer_shipment_requests_list'))
    expect(fn).toContain('r.client_id = public.current_customer_client()')
    expect(fn).toContain('left join public.shipments sh on sh.id = r.converted_shipment_id')
  })
  it('Y: reclamação cria um customer_support_tickets de verdade', () => {
    expect(foundation).toContain('create table public.customer_support_tickets')
    expect(foundation).toContain('customer_support_ticket_create')
  })
  it('Z: tickets também são escopados por current_customer_client()', () => {
    const fn = foundation.slice(foundation.indexOf('create or replace function public.customer_support_tickets_list'), foundation.indexOf('grant execute on function public.customer_support_tickets_list'))
    expect(fn).toContain('client_id = public.current_customer_client()')
  })
  it('AA: as 3 policies de storage.objects conferem posse do ticket (join em customer_support_tickets) — nunca um bucket público sem checagem', () => {
    const bucket = staff.slice(staff.indexOf("insert into storage.buckets"))
    expect(bucket).toContain("'customer-support-attachments', 'customer-support-attachments', false")
    const policyCount = (bucket.match(/on storage\.objects/g) ?? []).length
    expect(policyCount).toBe(3)
    expect(bucket).toContain('t.client_id = public.current_customer_client()')
    expect(bucket).toContain('t.organization_id in (select public.current_user_org_ids())')
  })
})

describe('AB — mobile 390px sem overflow horizontal', () => {
  it('nenhum container principal tem largura fixa maior que a viewport-alvo', () => {
    expect(portalCss).not.toMatch(/(?<!max-|min-)width:\s*[4-9]\d{2}px/)
  })
  it('bottom nav e itens interativos têm alvo de toque adequado', () => {
    expect(portalCss).toMatch(/min-height:\s*(44|48|52)px/)
  })
  it('há uma media query dedicada para 390px', () => {
    expect(portalCss).toContain('@media (max-width:390px)')
  })
})

describe('AC — nenhum texto técnico exposto para a cliente', () => {
  it('a UI do portal nunca mostra client_id/allocation_id/stock_managed/physical_ml/available_ml como texto visível', () => {
    for (const jargon of ['client_id', 'allocation_id cru', 'stock_managed', 'legacy_manual_verified', 'physical_ml=', 'available_ml=']) {
      expect(portalApp).not.toContain(jargon)
    }
  })
  it('as mensagens do portal são em português (rótulos-chave presentes)', () => {
    expect(portalApp).toContain('Disponível para envio')
    expect(portalApp).toContain('Solicitar envio')
  })
})

describe('idempotência de convite: nunca reconvida quem já está ativo, nunca recria um segundo auth.users para o mesmo cliente', () => {
  it('client_accounts tem client_id UNIQUE (um vínculo por cliente)', () => {
    expect(foundation).toContain('create unique index client_accounts_client_uidx on public.client_accounts(client_id)')
  })
  it('client_account_prepare_invite recusa preparar convite para conta já ativa', () => {
    const fn = claim.slice(claim.indexOf('create or replace function public.client_account_prepare_invite'), claim.indexOf('revoke all on function public.client_account_prepare_invite'))
    expect(fn).toContain("raise exception 'account_already_active'")
  })
  it('customer-claim-start só chama inviteUserByEmail quando auth_user_id ainda não existe', () => {
    const block = claimStartFn.slice(claimStartFn.indexOf('if (!account.auth_user_id)'))
    expect(block).toContain('inviteUserByEmail')
  })
})

describe('service_role só nas Edge Functions, nunca no frontend do portal', () => {
  it('customer-portal.ts (frontend) nunca referencia SERVICE_ROLE', () => {
    expect(portalLib).not.toContain('SERVICE_ROLE')
    expect(portalLib).not.toContain('service_role')
  })
  it('client_account_link_auth_user (grava o auth_user_id vindo do Admin API) só pode ser chamada por service_role', () => {
    const fn = claim.slice(claim.indexOf('create or replace function public.client_account_link_auth_user'), claim.indexOf('commit;'))
    expect(fn).toContain('revoke all on function public.client_account_link_auth_user(uuid, uuid) from public, anon, authenticated')
    expect(fn).toContain('grant execute on function public.client_account_link_auth_user(uuid, uuid) to service_role')
  })
})
