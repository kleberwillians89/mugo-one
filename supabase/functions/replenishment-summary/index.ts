// Inteligência de Reposição: traduz os sinais determinísticos (public.replenishment_signals)
// para uma frase em português. A IA nunca recalcula estoque/vendas/velocidade — só recebe o
// jsonb já pronto e o resumo determinístico de referência, e não pode contradizê-los.
// Sem OPENAI_API_KEY (ou qualquer falha do provedor), degrada graciosamente para o resumo
// determinístico — a tela de reposição nunca fica sem texto por causa da IA.
import { context, json, audit } from '../_shared/security.ts'
import { buildDeterministicSummary, ReplenishmentSignalRow } from '../_shared/replenishment-domain.ts'

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) => json(body, status, req)
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId, role } = ctx

  const itemId = String(body.item_id ?? '').trim()
  if (!itemId) return respond({ error: { code: 'invalid_payload', message: 'Informe o item de estoque.' } }, 400)
  if (!['admin', 'manager', 'operator', 'viewer'].includes(role)) {
    return respond({ error: { code: 'forbidden', message: 'Perfil sem acesso à inteligência de reposição.' } }, 403)
  }

  // Sem tabela nova de bookkeeping: reaproveita audit_logs (já existe) para o rate limit.
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await client.from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('actor_id', user.id).eq('action', 'replenishment_ai_summary').gte('created_at', since)
  if ((count ?? 0) >= 5) return respond({ error: { code: 'rate_limit', message: 'Limite de análises atingido. Aguarde um minuto.' } }, 429)

  const { data: signals, error } = await client.rpc('replenishment_signals', { org_id: organizationId })
  if (error) {
    console.error(JSON.stringify({ stage: 'replenishment_signals', error_code: error.code, organization_id: organizationId }))
    return respond({ error: { code: 'SIGNALS_QUERY_FAILED', message: 'Não foi possível calcular os sinais de reposição.' } }, 500)
  }
  const signal = (signals as ReplenishmentSignalRow[] | null)?.find((row) => row.item_id === itemId)
  if (!signal) return respond({ error: { code: 'not_found', message: 'Item de estoque não encontrado.' } }, 404)

  const deterministic = buildDeterministicSummary(signal)
  const fallback = () => respond({ data: { resumo: deterministic, status: signal.status, ai_generated: false } })

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    await audit(client, organizationId, user.id, 'replenishment_ai_summary', 'inventory_item', itemId, { status: signal.status, ai: false })
    return fallback()
  }

  const payload = {
    model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini',
    max_output_tokens: 400,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'system',
        content: `Você é uma analista de estoque explicando para uma pessoa não técnica. Use exclusivamente os números fornecidos e NUNCA invente estoque, vendas, velocidade, fornecedor ou preço. Nunca contradiga o status já calculado ("${signal.status}") nem os números do resumo determinístico de referência. No máximo 2 frases curtas, tom prático e direto, em português.`,
      },
      { role: 'user', content: JSON.stringify({ agregados_autorizados: signal, resumo_deterministico: deterministic }) },
    ],
    text: {
      format: {
        type: 'json_schema', name: 'replenishment_summary', strict: true,
        schema: { type: 'object', additionalProperties: false, required: ['resumo'], properties: { resumo: { type: 'string' } } },
      },
    },
  }

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return fallback()
  }
  if (!response.ok) return fallback()

  let raw: Record<string, unknown>
  try { raw = await response.json() } catch { return fallback() }

  const outputText = typeof raw.output_text === 'string' ? raw.output_text :
    (raw.output as { content?: unknown[] }[] | undefined)?.flatMap((item) => item.content ?? [])
      .find((item: { type?: string; text?: string }) => item.type === 'output_text')?.text

  let answer: { resumo?: string } = {}
  try { if (typeof outputText === 'string' && outputText.trim()) answer = JSON.parse(outputText) } catch { /* usa fallback abaixo */ }

  const resumo = (answer.resumo && answer.resumo.trim()) || deterministic
  await audit(client, organizationId, user.id, 'replenishment_ai_summary', 'inventory_item', itemId, { status: signal.status, ai: Boolean(answer.resumo) })
  return respond({ data: { resumo, status: signal.status, ai_generated: Boolean(answer.resumo) } })
})
