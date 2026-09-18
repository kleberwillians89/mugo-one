import { context, json } from '../_shared/security.ts'

// fiscal-request: wrapper autenticado que a Venda 360 chama para
// "Emitir NFS-e" (briefing §16). Faz a mesma coisa que send-email fez
// na Sprint N para o Communication Hub: chama a RPC de domínio com a
// sessão real do usuário (RLS/permissão aplicadas normalmente) e, só
// depois, acorda a fiscal-issue (server-to-server, com o segredo
// compartilhado que NUNCA sai daqui para o frontend).
Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response

  const saleId = String(ctx.body.sale_id ?? '')
  const documentType = String(ctx.body.document_type ?? 'nfse')
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return json({ error: { code: 'invalid_payload', message: 'sale_id inválido.' } }, 400, req)

  const { data, error } = await ctx.client.rpc('request_fiscal_document', {
    p_organization_id: ctx.organizationId, p_sale_id: saleId, p_document_type: documentType,
  })
  if (error) {
    const message = error.message ?? ''
    const code = message.includes('MISSING_FISCAL_PROFILE') ? 'MISSING_FISCAL_PROFILE'
      : message.includes('MISSING_RECIPIENT_DOCUMENT') ? 'MISSING_RECIPIENT_DOCUMENT'
      : message.includes('sale_cancelled') ? 'sale_cancelled'
      : message.includes('sale_organization_mismatch') ? 'TENANT_MISMATCH'
      : message.includes('forbidden') ? 'forbidden'
      : message.includes('document_type_not_available_yet') ? 'document_type_not_available_yet'
      : 'processing_error'
    const status = code === 'forbidden' ? 403 : code === 'TENANT_MISMATCH' ? 404 : code === 'processing_error' ? 500 : 422
    return json({ error: { code, message: 'Não foi possível solicitar o documento fiscal.' } }, status, req)
  }

  const workerSecret = Deno.env.get('AUTOMATION_WORKER_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (workerSecret && supabaseUrl) {
    const wake = fetch(`${supabaseUrl}/functions/v1/fiscal-issue`, { method: 'POST', headers: { 'x-worker-secret': workerSecret } })
      .catch((err) => console.error({ event: 'fiscal_issue_wake_failed', message: String(err) }))
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (runtime) runtime.waitUntil(wake); else await wake
  }

  return json({ data }, 200, req)
})
