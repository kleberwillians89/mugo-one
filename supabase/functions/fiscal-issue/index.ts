import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { constantTimeEqual } from '../_shared/manychat.ts'
import { NuvemFiscalAdapter } from '../_shared/nuvem-fiscal-adapter.ts'
import { FiscalProvider } from '../_shared/fiscal-provider.ts'

// fiscal-issue: chama o FiscalProvider fora da transação de domínio
// (briefing §21) — request_fiscal_document já criou o
// fiscal_document em 'requested'; esta função faz a chamada HTTP de
// verdade e grava o resultado via update_fiscal_document_status.
//
// NÃO é endpoint público aberto (briefing §21) — mesmo padrão de
// automation-worker: segredo compartilhado comparado em tempo
// constante, --no-verify-jwt porque não há sessão de usuário
// server-to-server.
//
// PROVIDER E2E NOT TESTED: a Nuvem Fiscal está desativada (ver
// docs/FISCAL_MIGRATION_PLAN.md §0) — sem NUVEM_FISCAL_CLIENT_ID/
// NUVEM_FISCAL_CLIENT_SECRET configurados (e não há mais serviço para
// obtê-los), esta função sempre resulta em 'failed'/
// PROVIDER_NOT_CONFIGURED ou PROVIDER_NOT_VERIFIED — nunca inventa um
// sucesso. O contrato (FiscalProvider) e o fluxo local (claim →
// status → evento) estão prontos para um adapter real assim que um
// provider ativo for escolhido.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function buildProvider(): FiscalProvider {
  return new NuvemFiscalAdapter({
    clientId: Deno.env.get('NUVEM_FISCAL_CLIENT_ID'),
    clientSecret: Deno.env.get('NUVEM_FISCAL_CLIENT_SECRET'),
    baseUrl: Deno.env.get('NUVEM_FISCAL_BASE_URL'),
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed' } }, 405)

  const secret = Deno.env.get('AUTOMATION_WORKER_SECRET')
  const provided = req.headers.get('x-worker-secret') ?? ''
  if (!secret || !constantTimeEqual(provided, secret)) return json({ error: { code: 'unauthorized' } }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: { code: 'server_config' } }, 503)
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: claimed, error: claimError } = await admin.rpc('claim_requested_fiscal_documents', { p_limit: 10 })
  if (claimError) {
    console.error({ event: 'fiscal_issue_claim_failed', code: claimError.code })
    return json({ error: { code: 'processing_error' } }, 500)
  }

  const rows = (claimed ?? []) as Array<{
    id: string; organization_id: string; document_type: string; environment: 'sandbox' | 'production'
    total_amount: number; recipient_snapshot: Record<string, unknown>; issuer_snapshot: Record<string, unknown>; idempotency_key: string
  }>

  const provider = buildProvider()
  let authorized = 0
  let failed = 0

  for (const row of rows) {
    // Guarda de ambiente (briefing §79): nunca emite em produção sem
    // configuração explícita — ambiente vem do próprio documento
    // (decidido em request_fiscal_document a partir do perfil fiscal),
    // nunca inferido aqui.
    const result = await provider.issueServiceInvoice({
      environment: row.environment,
      issuer: row.issuer_snapshot,
      recipient: row.recipient_snapshot,
      items: [],
      totalAmount: row.total_amount,
      externalId: row.idempotency_key,
    })

    if (result.ok) {
      await admin.rpc('update_fiscal_document_status', {
        p_fiscal_document_id: row.id, p_status: result.data.status,
        p_provider_document_id: result.data.providerDocumentId, p_provider_status: result.data.providerStatus,
        p_number: result.data.number, p_series: result.data.series, p_access_key: result.data.accessKey,
      })
      authorized++
    } else {
      await admin.rpc('update_fiscal_document_status', {
        p_fiscal_document_id: row.id, p_status: 'failed', p_error_code: result.errorCode, p_error_message: result.errorMessage,
      })
      failed++
    }
  }

  console.log({ event: 'fiscal_issue_processed', claimed: rows.length, authorized, failed })
  return json({ data: { claimed: rows.length, authorized, failed } }, 200)
})
