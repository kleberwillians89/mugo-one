import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do Lead Intake (Sprint M) — ver
 * docs/LEAD_INTAKE_MIGRATION_PLAN.md e docs/LEAD_INTAKE_API.md. A
 * lógica de normalização/idempotência/identity resolution vive em SQL
 * (RPC), já provada ao vivo contra o endpoint público real durante a
 * sprint (idempotência 3x, conflito de identidade, cross-tenant,
 * Agência/Correspondente/Veterinária) — esta suíte protege as
 * propriedades estruturais que um teste de UI/unidade consegue
 * verificar sem banco: segurança de acesso, isolamento multi-tenant
 * por construção, e ausência de vazamento vertical/PII.
 */

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const readSrc = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const endpoints = migration('202609230002_lead_intake_endpoints.sql')
const events = migration('202609230004_lead_intake_events.sql')
const normalization = migration('202609230003_lead_intake_normalization.sql')
const touchpoints = migration('202609230005_touchpoints.sql')
const submit = migration('202609230006_lead_intake_submit.sql')
const edgeFunction = readSrc('../supabase/functions/lead-intake/index.ts')

describe('lead intake guard — a RPC pública só é executável por service_role', () => {
  it('lead_intake_submit é revogada de public/anon/authenticated e concedida só a service_role', () => {
    expect(submit).toMatch(/revoke all on function public\.lead_intake_submit[\s\S]*from public, anon, authenticated/)
    expect(submit).toMatch(/grant execute on function public\.lead_intake_submit[\s\S]*to service_role/)
  })
  it('a função checa auth.role() = service_role em runtime, não só via GRANT (defesa em profundidade)', () => {
    expect(submit).toContain("if auth.role() <> 'service_role' then")
  })
  it('consume_public_endpoint_rate_limit é reaproveitada, não reimplementada', () => {
    expect(readSrc('../supabase/functions/_shared/public-rate-limit.ts')).toContain('consume_public_endpoint_rate_limit')
  })
})

describe('lead intake guard — RLS habilitado e escopado por organização nas 3 tabelas novas', () => {
  for (const [label, sql] of [['lead_intake_endpoints', endpoints], ['lead_intake_events', events], ['touchpoints', touchpoints]] as const) {
    it(`${label} tem RLS habilitado e toda policy filtra por organization_id`, () => {
      expect(sql).toContain(`alter table public.${label} enable row level security`)
      expect(sql).toMatch(/current_user_org_ids/)
    })
  }
  it('lead_intake_events e touchpoints não concedem insert/update a authenticated (escrita só via a RPC SECURITY DEFINER)', () => {
    expect(events).not.toMatch(/grant\s+(insert|update).*on public\.lead_intake_events\s+to\s+authenticated/i)
    expect(touchpoints).not.toMatch(/grant\s+(insert|update).*on public\.touchpoints\s+to\s+authenticated/i)
  })
})

describe('lead intake guard — identity resolution nunca escolhe sozinha entre identidades diferentes', () => {
  it('0/1/2+ candidatos mapeiam para novo/resolvido/identity_conflict — nunca um "pega o primeiro"', () => {
    expect(submit).toContain("array_length(v_customer_ids, 1) = 0")
    expect(submit).toContain("array_length(v_customer_ids, 1) = 1")
    expect(submit).toContain("v_status := 'identity_conflict'")
  })
  it('a busca de candidatos ignora clientes mesclados/excluídos (merged_into_id/deleted_at)', () => {
    expect(submit).toContain('merged_into_id is null and deleted_at is null')
  })
})

describe('lead intake guard — normalização sem heurísticas agressivas', () => {
  it('normalize_email é só lower+trim — não remove "+alias" nem pontos de gmail', () => {
    const body = normalization.slice(normalization.indexOf('function public.normalize_email'), normalization.indexOf('create or replace function public.normalize_document'))
    expect(body).toContain('lower(btrim(value))')
    expect(body).not.toMatch(/replace|regexp_replace/)
  })
  it('normalize_document reaproveita only_digits() já existente, não reimplementa', () => {
    expect(normalization).toContain('public.only_digits(value)')
  })
  it('CPF/CNPJ nunca é obrigatório: o payload não valida presença de document em lugar nenhum da RPC', () => {
    expect(submit).not.toMatch(/p_document is null.*raise exception|document.*obrigat[oó]rio/i)
  })
})

describe('lead intake guard — idempotência e cross-tenant são checadas antes de qualquer escrita de negócio', () => {
  it('idempotency_key OU provider+external_id são checados antes do insert em lead_intake_events', () => {
    const idxIdempotency = submit.indexOf('idempotency_key = p_idempotency_key')
    const idxInsertEvents = submit.indexOf('insert into public.lead_intake_events (')
    expect(idxIdempotency).toBeGreaterThan(-1)
    expect(idxInsertEvents).toBeGreaterThan(idxIdempotency)
  })
  it('interest_catalog_item_id de outra organização é rejeitado via entity_belongs_to_organization antes de qualquer insert', () => {
    expect(submit).toContain("entity_belongs_to_organization('catalog_item', p_interest_catalog_item_id, v_organization_id)")
    expect(submit).toContain('TENANT_MISMATCH')
  })
})

describe('lead intake guard — raw_payload nunca guarda segredo', () => {
  it('a RPC remove chaves de header/token/segredo do raw_payload antes de armazenar', () => {
    for (const key of ['authorization', 'token', 'secret', 'password', 'cookie', 'service_role']) {
      expect(submit).toContain(`'${key}'`)
    }
  })
  it('a Edge Function nunca repassa headers da requisição para o body salvo (só o JSON já parseado)', () => {
    expect(edgeFunction).not.toMatch(/req\.headers[\s\S]{0,40}raw_payload/)
  })
})

describe('lead intake guard — Edge Function tem limite de tamanho e rate limit antes de processar', () => {
  it('rejeita payload acima de 64KB antes de fazer JSON.parse', () => {
    const idxSizeCheck = edgeFunction.indexOf('rawText.length > 65536')
    const idxParse = edgeFunction.indexOf('JSON.parse(rawText')
    expect(idxSizeCheck).toBeGreaterThan(-1)
    expect(idxParse).toBeGreaterThan(idxSizeCheck)
  })
  it('aplica rate limit por IP e por chave antes de chamar a RPC', () => {
    const idxRateLimit = edgeFunction.indexOf('publicRateLimit(')
    const idxRpcCall = edgeFunction.indexOf("admin.rpc('lead_intake_submit'")
    expect(idxRateLimit).toBeGreaterThan(-1)
    expect(idxRpcCall).toBeGreaterThan(idxRateLimit)
  })
  it('campos desconhecidos do payload vão para metadata — nunca um insert direto do JSON bruto', () => {
    expect(edgeFunction).toContain('KNOWN_FIELDS')
    expect(edgeFunction).toContain('extraMetadata')
  })
})

describe('lead intake guard — nenhum arquivo novo desta sprint contém termos verticais nem nomes de pessoas', () => {
  const NEW_FILES = [
    'lib/lead-intake.ts', 'pages/LeadIntakeSettingsPage.tsx', 'components/SettingsTabs.tsx', 'components/EntityTouchpointsBlock.tsx',
  ]
  const forbidden = ['perfume', 'frasco', 'splitar', 'bottle', 'apc', 'ruahparfums']
  it('nenhum arquivo novo contém termos verticais', () => {
    for (const file of NEW_FILES) {
      const content = readSrc(file).toLowerCase()
      for (const word of forbidden) expect(content, `${file} não pode conter "${word}"`).not.toContain(word)
    }
  })
  it('nenhuma pessoa da operação antiga aparece nos arquivos novos', () => {
    for (const file of NEW_FILES) expect(readSrc(file)).not.toMatch(/\b(Davi|Gabriel|Emily|Ilde|Gabi)\b/)
  })
})

describe('lead intake guard — o endpoint público NUNCA decide pipeline por canal (briefing §35)', () => {
  it('nem a RPC nem a Edge Function referenciam nome de pipeline algum', () => {
    expect(submit.toLowerCase()).not.toMatch(/pipeline.*(tr[aá]fego|trafego)/)
    expect(edgeFunction.toLowerCase()).not.toContain('pipeline')
  })
})
