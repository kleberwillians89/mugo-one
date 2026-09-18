import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do Fiscal Core (Sprint P) — ver
 * docs/FISCAL_MIGRATION_PLAN.md. O caminho de negócio completo
 * (idempotência 3x, imutabilidade de autorizado, cancelamento,
 * cross-tenant, automação sale.created→issue_fiscal_document em 4
 * organizações) já foi provado ao vivo contra o staging durante a
 * sprint. Esta suíte protege: (a) que nenhuma decisão tributária é
 * tomada por segmento (a regra fundamental do briefing), e (b) as
 * propriedades estruturais que não dependem de banco.
 */

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const readSrc = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const profiles = migration('202609260002_organization_fiscal_profiles.sql')
const connections = migration('202609260003_fiscal_connections.sql')
const documents = migration('202609260004_fiscal_documents.sql')
const operations = migration('202609260005_fiscal_operations.sql')
const statusAndCancel = migration('202609260006_fiscal_status_and_cancel.sql')
const paymentEvent = migration('202609260007_payment_paid_event.sql')
const automationAction = migration('202609260008_fiscal_automation_action.sql')
const nuvemAdapter = readSrc('../supabase/functions/_shared/nuvem-fiscal-adapter.ts')
const fiscalIssue = readSrc('../supabase/functions/fiscal-issue/index.ts')
const fiscalRequest = readSrc('../supabase/functions/fiscal-request/index.ts')

describe('fiscal guard — regra fundamental: nenhuma decisão tributária por segmento', () => {
  const forbidden = [/if\s*\(\s*.*veterinar/i, /if\s*\(\s*.*agencia/i, /if\s*\(\s*.*clinic/i, /if\s*\(\s*.*\bstore\b/i, /if\s*veterinary/i, /if\s*agency/i]
  it('nenhuma migration fiscal contém um "if segmento" para decidir CNAE/código de serviço/CFOP/CSOSN/CST/alíquota', () => {
    for (const sql of [profiles, connections, documents, operations, statusAndCancel, automationAction]) {
      for (const pattern of forbidden) expect(sql).not.toMatch(pattern)
    }
  })
  it('tax_regime é um campo livre configurado — a RPC de emissão nunca lê organization_fiscal_profiles.tax_regime para ramificar lógica', () => {
    // A RPC monta o snapshot copiando o campo (repassa o valor), mas
    // nunca usa "if v_profile.tax_regime = ..." em nenhuma decisão.
    expect(operations).not.toMatch(/if\s+v_profile\.tax_regime\s*=/)
  })
})

describe('fiscal guard — idempotência é garantida em dois níveis', () => {
  it('índice único parcial: no máximo 1 documento não-terminal por (organization_id, sale_id, document_type)', () => {
    expect(documents).toContain('create unique index fiscal_documents_open_request_idx')
    expect(documents).toContain("where status not in ('failed', 'cancelled') and sale_id is not null")
  })
  it('request_fiscal_document também checa antes de inserir (idempotência de negócio, não só constraint)', () => {
    expect(operations).toContain("status not in ('failed', 'cancelled')")
    expect(operations).toContain("'already_requested', true")
  })
})

describe('fiscal guard — documento autorizado é imutável', () => {
  it('trigger bloqueia mudança de conteúdo ou status (exceto para cancelled) depois de authorized', () => {
    expect(documents).toContain('fiscal_documents_prevent_authorized_edit')
    expect(documents).toContain("old.status = 'authorized' and new.status not in ('authorized', 'cancelled')")
  })
})

describe('fiscal guard — status nunca regride e evento só na mudança real', () => {
  it('update_fiscal_document_status ignora um status terminal e um status igual ao atual', () => {
    expect(statusAndCancel).toContain("v_document.status in ('authorized', 'cancelled')")
    expect(statusAndCancel).toContain('ignored_terminal')
    expect(statusAndCancel).toContain("'status', 'unchanged'")
  })
})

describe('fiscal guard — payment.paid só a partir da fonte de verdade real, nunca de SELECT/frontend', () => {
  it('emitido de dentro de collections_register_payment, só para vendas que mudaram (changed_ids), nunca skipped', () => {
    expect(paymentEvent).toContain("emit_domain_event(\n      sale_row.organization_id, 'payment.paid'")
    const emitIndex = paymentEvent.indexOf("emit_domain_event(\n      sale_row.organization_id, 'payment.paid'")
    const skippedIndex = paymentEvent.indexOf('skipped_ids:=array_append')
    expect(emitIndex).toBeGreaterThan(skippedIndex)
  })
})

describe('fiscal guard — payload de evento fiscal é mínimo (briefing §23)', () => {
  it('nenhum evento fiscal carrega XML/certificado/payload completo do provider', () => {
    for (const sql of [operations, statusAndCancel]) {
      expect(sql.toLowerCase()).not.toMatch(/'xml'|'certificate'|'certificado'|provider_response_metadata.*payload/)
    }
  })
})

describe('fiscal guard — issue_fiscal_document nunca chama o provider diretamente', () => {
  it('a action só chama request_fiscal_document (mesma RPC da emissão manual)', () => {
    expect(automationAction).toContain('return public.request_fiscal_document(')
    expect(automationAction).not.toMatch(/nuvemfiscal|api\.nuvemfiscal/i)
  })
  it('set_automation_actions e o CHECK da tabela concordam sobre a nova action (bug real corrigido nesta sprint)', () => {
    expect(automationAction).toContain("'create_task', 'send_email', 'issue_fiscal_document'")
  })
})

describe('fiscal guard — RLS multi-tenant nas 4 tabelas novas', () => {
  const tables: [string, string][] = [
    ['organization_fiscal_profiles', profiles], ['fiscal_connections', connections],
    ['fiscal_documents', documents], ['fiscal_document_items', documents],
  ]
  it('cada tabela tem row level security habilitado', () => {
    for (const [table, sql] of tables) {
      expect(sql, `${table} deveria ter RLS habilitado`).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })
  it('fiscal_documents/fiscal_document_items não concedem insert/update a authenticated (escrita só via RPC)', () => {
    expect(documents).not.toMatch(/grant\s+(insert|update).*on public\.fiscal_documents\s+to\s+authenticated/i)
    expect(documents).not.toMatch(/grant\s+(insert|update).*on public\.fiscal_document_items\s+to\s+authenticated/i)
  })
})

describe('fiscal guard — segredo do provider nunca aparece no Core/frontend', () => {
  it('nenhum arquivo novo de frontend cita client_secret/NUVEM_FISCAL_CLIENT_SECRET', () => {
    for (const file of ['lib/fiscal.ts', 'pages/FiscalSettingsPage.tsx', 'pages/FiscalPage.tsx', 'components/EntityFiscalBlock.tsx']) {
      expect(readSrc(file)).not.toMatch(/client_secret|NUVEM_FISCAL_CLIENT_SECRET|VITE_NUVEM/i)
    }
  })
  it('fiscal_connections.credentials_reference é só rótulo — nenhuma coluna literal de segredo', () => {
    expect(connections).not.toMatch(/\b(client_secret|access_token|certificate)\s+text/)
  })
})

describe('fiscal guard — Edge Functions fiscais não são endpoints públicos abertos', () => {
  it('fiscal-issue exige segredo compartilhado comparado em tempo constante', () => {
    expect(fiscalIssue).toContain('constantTimeEqual')
    expect(fiscalIssue).toContain("req.headers.get('x-worker-secret')")
  })
  it('fiscal-request exige sessão autenticada (context(), não segredo público)', () => {
    expect(fiscalRequest).toContain('await context(req)')
  })
  it('claim usa FOR UPDATE SKIP LOCKED', () => {
    expect(readSrc('../supabase/migrations/202609260010_claim_requested_fiscal_documents.sql')).toContain('for update of d skip locked')
  })
})

describe('fiscal guard — NuvemFiscalAdapter nunca finge sucesso sem verificação real', () => {
  it('métodos não confirmados retornam PROVIDER_NOT_VERIFIED explicitamente', () => {
    expect(nuvemAdapter).toContain('PROVIDER_NOT_VERIFIED')
    // issueServiceInvoice só troca token e devolve NOT_VERIFIED — nunca
    // um "return { ok: true, ...}" dentro do próprio corpo do método.
    const methodBody = nuvemAdapter.slice(nuvemAdapter.indexOf('async issueServiceInvoice'), nuvemAdapter.indexOf('async getDocument'))
    expect(methodBody).not.toContain('ok: true')
    expect(methodBody).toContain('return NOT_VERIFIED')
  })
})

describe('fiscal guard — nfe/nfce têm estrutura pronta mas emissão bloqueada explicitamente', () => {
  it('fiscal_documents.document_type aceita os 3 tipos', () => {
    expect(documents).toContain("document_type in ('nfse', 'nfe', 'nfce')")
  })
  it('request_fiscal_document recusa qualquer tipo diferente de nfse nesta sprint', () => {
    expect(operations).toContain("if p_document_type <> 'nfse' then")
    expect(operations).toContain("raise exception 'document_type_not_available_yet'")
  })
})
