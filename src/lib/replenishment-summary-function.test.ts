import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const summary = readFileSync(new URL('../../supabase/functions/replenishment-summary/index.ts', import.meta.url), 'utf8')

describe('replenishment-summary: auth/tenant compartilhados', () => {
  it('usa o contexto compartilhado, igual a todas as outras funções', () => {
    expect(summary).toContain("import { context, json, audit } from '../_shared/security.ts'")
    expect(summary).toContain('const ctx = await context(req)')
  })
})

describe('replenishment-summary: agregados vêm de RPC, nunca lê sales/inventory_items direto', () => {
  it('busca os sinais via replenishment_signals(org_id), não SELECT direto', () => {
    expect(summary).toContain("client.rpc('replenishment_signals', { org_id: organizationId })")
    expect(summary).not.toContain("from('sales')")
    expect(summary).not.toContain("from('inventory_items')")
  })

  it('o resumo determinístico é calculado ANTES de qualquer chamada à OpenAI', () => {
    const deterministicIdx = summary.indexOf('const deterministic = buildDeterministicSummary(signal)')
    const fetchIdx = summary.indexOf("fetch('https://api.openai.com")
    expect(deterministicIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(deterministicIdx)
  })
})

describe('replenishment-summary: degrada graciosamente, nunca deixa a tela sem texto', () => {
  it('sem OPENAI_API_KEY, responde 200 com o resumo determinístico (não erro)', () => {
    const block = summary.slice(summary.indexOf("const apiKey = Deno.env.get('OPENAI_API_KEY')"), summary.indexOf('const payload ='))
    expect(block).toContain('if (!apiKey)')
    expect(block).toContain('return fallback()')
  })

  it('timeout/erro de rede da OpenAI também caem no fallback determinístico, nunca em erro 5xx pro usuário', () => {
    expect(summary).toContain('} catch {\n    return fallback()\n  }')
  })

  it('IA nunca pode contradizer o status já calculado — instrução explícita no prompt', () => {
    expect(summary).toContain('Nunca contradiga o status já calculado')
    expect(summary).toContain('NUNCA invente estoque, vendas, velocidade, fornecedor ou preço')
  })

  it('resposta final sempre cai para o determinístico quando a IA não retorna texto válido', () => {
    expect(summary).toContain("const resumo = (answer.resumo && answer.resumo.trim()) || deterministic")
  })
})

describe('replenishment-summary: zero escrita em estoque/vendas', () => {
  it('nunca grava em inventory_items, sales ou inventory_allocations', () => {
    for (const table of ["from('inventory_items')", "from('sales')", "from('inventory_allocations')"]) {
      expect(summary).not.toContain(table)
    }
  })

  it('só grava auditoria (audit_logs, via helper compartilhado) e leitura via RPC', () => {
    expect(summary).toContain("await audit(client, organizationId, user.id, 'replenishment_ai_summary'")
  })
})

describe('replenishment-summary: rate limit sem nova tabela', () => {
  it('reaproveita audit_logs para contar tentativas recentes, sem criar tabela nova', () => {
    expect(summary).toContain("client.from('audit_logs').select('id'")
    expect(summary).toContain("'rate_limit'")
  })
})

describe('replenishment-summary: papéis', () => {
  it('admin/manager/operator/viewer podem gerar a análise (é leitura, não escrita de fonte)', () => {
    expect(summary).toContain("['admin', 'manager', 'operator', 'viewer'].includes(role)")
  })
})
