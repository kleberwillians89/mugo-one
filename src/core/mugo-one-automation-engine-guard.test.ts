import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do Event Engine + Automation Engine (Sprint O)
 * — ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md. O caminho de negócio
 * completo (lead.created→automação→create_task, create_task+send_email
 * com partially_failed, idempotência, loop bloqueado em depth=10,
 * isolamento entre 3 organizações) já foi provado ao vivo contra o
 * staging durante a sprint, incluindo 3 bugs reais só visíveis em
 * execução (overload de função, cast de record, entity_type inválido)
 * — esta suíte protege as propriedades estruturais que não dependem
 * de banco.
 */

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const readSrc = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const domainEvents = migration('202609250002_domain_events.sql')
const automationsSchema = migration('202609250003_automations_schema.sql')
const automationRuns = migration('202609250004_automation_runs.sql')
const automationCrud = migration('202609250005_automation_crud.sql')
const automationEngine = migration('202609250006_automation_engine.sql')
const fixOverloads = migration('202609250010_drop_stale_overloads.sql')
const fixRecordCast = migration('202609250011_fix_action_record_cast.sql')
const emailProviderCheck = migration('202609250012_send_email_action_provider_check.sql')
const entityWhitelist = migration('202609250013_create_task_action_entity_whitelist.sql')
const worker = readSrc('../supabase/functions/automation-worker/index.ts')

describe('automation engine guard — domain_events é emitido só de dentro de outra RPC', () => {
  it('emit_domain_event é revogada de public/anon/authenticated', () => {
    expect(domainEvents).toMatch(/revoke all on function public\.emit_domain_event[\s\S]*from public, anon, authenticated/)
  })
  it('domain_events só concede select a authenticated — nenhum insert/update direto', () => {
    expect(domainEvents).not.toMatch(/grant\s+(insert|update).*on public\.domain_events\s+to\s+authenticated/i)
  })
})

describe('automation engine guard — automations nasce sempre draft, nunca ativa silenciosamente', () => {
  it('a coluna status tem default \'draft\'', () => {
    expect(automationsSchema).toContain("status text not null default 'draft'")
  })
  it('create_automation nunca aceita um p_status como parâmetro (não há como nascer ativa)', () => {
    expect(automationCrud).not.toMatch(/create_automation\([^)]*p_status/)
  })
})

describe('automation engine guard — conditions nunca executam SQL arbitrário', () => {
  it('resolve_automation_field só reconhece um whitelist fechado de paths', () => {
    expect(automationEngine).toContain("p_field_path = 'event.type'")
    expect(automationEngine).toContain("p_field_path like 'event.payload.%'")
    expect(automationEngine).not.toMatch(/execute\s+format|execute\s+'/i)
  })
  it('automation_conditions.operator é restrito por CHECK a uma lista fechada', () => {
    expect(automationsSchema).toContain("operator in (\n    'equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty',\n    'greater_than', 'less_than', 'in', 'not_in'\n  )")
  })
})

describe('automation engine guard — idempotência e prevenção de loop', () => {
  it('automation_runs é único por (automation_id, event_id, automation_version)', () => {
    expect(automationRuns).toContain('create unique index automation_runs_idempotency_idx')
    expect(automationRuns).toContain('on public.automation_runs(automation_id, event_id, automation_version)')
  })
  it('a inserção do run usa ON CONFLICT DO NOTHING — reprocessar o mesmo evento nunca duplica', () => {
    expect(automationEngine).toContain('on conflict (automation_id, event_id, automation_version) do nothing')
  })
  it('causation_depth >= 10 interrompe a avaliação antes de rodar qualquer automação', () => {
    expect(automationEngine).toContain('if v_event.causation_depth >= 10 then return; end if;')
  })
  it('causation_depth é calculado a partir do pai na própria inserção do evento (sem CTE recursiva)', () => {
    expect(domainEvents).toContain('v_depth := coalesce(v_parent_depth, 0)')
  })
})

describe('automation engine guard — actions reaproveitam as RPCs de domínio, nunca duplicam insert', () => {
  it('run_create_task_action chama public.create_task (não faz insert into tasks direto)', () => {
    expect(automationEngine).toContain('return public.create_task(')
    expect(automationEngine).not.toMatch(/insert into public\.tasks/)
  })
  it('run_send_email_action chama public.send_communication_message (não chama a API do Resend)', () => {
    expect(automationEngine).toContain('return public.send_communication_message(')
    expect(automationEngine).not.toMatch(/api\.resend\.com/)
  })
})

describe('automation engine guard — falha de action nunca desaparece nem derruba o evento causador', () => {
  it('execute_automation_action captura qualquer exceção da action e grava failed com erro sanitizado (300 chars)', () => {
    expect(automationEngine).toContain('exception when others then')
    expect(automationEngine).toContain("v_error_message := left(sqlerrm, 300);")
  })
  it('emit_domain_event nunca deixa uma falha de automação subir para quem emitiu o evento original', () => {
    expect(domainEvents).toContain('exception when others then')
    expect(domainEvents).toContain("update public.domain_events set processing_status = 'failed'")
  })
})

describe('automation engine guard — 3 bugs reais de execução ficam corrigidos e documentados', () => {
  it('overloads antigas de create_task/send_communication_message foram derrubadas explicitamente', () => {
    expect(fixOverloads).toContain('drop function if exists public.create_task(uuid, text, text, text, uuid, timestamptz, text, uuid)')
    expect(fixOverloads).toContain('drop function if exists public.send_communication_message(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text)')
  })
  it('evaluate_and_run_automations declara a action com o tipo da tabela, não "record" genérico', () => {
    expect(fixRecordCast).toContain('v_action public.automation_actions;')
    expect(fixRecordCast).not.toMatch(/v_action record;/)
  })
  it('run_create_task_action só herda entity_type do evento quando está na whitelist de tasks.entity_type', () => {
    expect(entityWhitelist).toContain("array['customer','company','contact','lead','deal','sale']")
  })
})

describe('automation engine guard — send_email detecta ausência de provider na própria execução (não só depois, assíncrono)', () => {
  it('run_send_email_action levanta provider_not_configured quando não há connection ativa', () => {
    expect(emailProviderCheck).toContain("raise exception 'provider_not_configured';")
    expect(emailProviderCheck).toContain("status = 'connected'")
  })
})

describe('automation engine guard — worker não é endpoint público aberto', () => {
  it('automation-worker exige um segredo compartilhado, comparado em tempo constante', () => {
    expect(worker).toContain('constantTimeEqual')
    expect(worker).toContain("req.headers.get('x-worker-secret')")
  })
  it('claim usa FOR UPDATE SKIP LOCKED — dois workers nunca processam a mesma message', () => {
    expect(readSrc('../supabase/migrations/202609250014_claim_queued_messages.sql')).toContain('for update of m skip locked')
  })
})

describe('automation engine guard — RLS multi-tenant nas 6 tabelas novas', () => {
  const tables: [string, string][] = [
    ['domain_events', domainEvents], ['automations', automationsSchema],
    ['automation_conditions', automationsSchema], ['automation_actions', automationsSchema],
    ['automation_runs', automationRuns], ['automation_action_runs', automationRuns],
  ]
  it('cada tabela tem row level security habilitado', () => {
    for (const [table, sql] of tables) {
      expect(sql, `${table} deveria ter RLS habilitado`).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })
})

describe('automation engine guard — sem lógica de negócio por segmento', () => {
  const forbidden = [/agencia/i, /veterinaria/i, /correspondente/i, /\bloja\b/i, /ruahparfums/i]
  const NEW_FILES = ['lib/automations.ts', 'pages/AutomationsPage.tsx', 'components/AutomationDetailDrawer.tsx']
  it('nenhum arquivo novo cita um segmento específico', () => {
    for (const file of NEW_FILES) {
      const content = readSrc(file)
      for (const word of forbidden) expect(content, `${file} não pode conter ${word}`).not.toMatch(word)
    }
  })
  it('nenhuma permissão nova é por action (automations.create_task/automations.send_email não existem)', () => {
    const permissions = readSrc('lib/permissions.ts')
    expect(permissions).not.toContain("'automations.create_task'")
    expect(permissions).not.toContain("'automations.send_email'")
  })
})
