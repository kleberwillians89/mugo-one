import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const search = readFileSync(new URL('../../supabase/functions/radar-search/index.ts', import.meta.url), 'utf8')
const summary = readFileSync(new URL('../../supabase/functions/radar-summary/index.ts', import.meta.url), 'utf8')

describe('radar-search: provider não configurado', () => {
  it('checa RADAR_SEARCH_PROVIDER e RADAR_SEARCH_API_KEY antes de qualquer chamada externa', () => {
    expect(search).toContain("Deno.env.get('RADAR_SEARCH_PROVIDER')")
    expect(search).toContain("Deno.env.get('RADAR_SEARCH_API_KEY')")
  })

  it('sem provider, responde available:false com a mensagem exata do spec', () => {
    expect(search).toContain('Busca externa ainda não configurada.')
    expect(search).toContain('available: false')
  })

  it('nunca faz fetch a um provider externo sem provider+apiKey configurados', () => {
    const notConfiguredIdx = search.indexOf('!provider || !apiKey')
    const fetchIdx = search.indexOf("fetch(")
    expect(notConfiguredIdx).toBeGreaterThan(-1)
    // não há nenhuma chamada fetch neste arquivo v1 (sem adapter real implementado)
    expect(fetchIdx).toBe(-1)
  })

  it('nunca fabrica preço, url ou pais default para uma oferta', () => {
    expect(search).not.toMatch(/price_native\s*:\s*[\d.]/)
    expect(search).not.toMatch(/url\s*:\s*['"]https?:\/\//)
  })

  it('sempre registra o request em radar_search_runs e audita início/fim', () => {
    expect(search).toContain("client.from('radar_search_runs').insert")
    expect(search).toContain("'radar_search_started'")
    expect(search).toContain("'radar_search_completed'")
  })

  it('usa o contexto compartilhado de autenticação/tenant', () => {
    expect(search).toContain("import { context, json, audit } from '../_shared/security.ts'")
    expect(search).toContain('const ctx = await context(req)')
  })
})

describe('radar-summary: IA recebe apenas agregados determinísticos', () => {
  it('usa o contexto compartilhado de autenticação/tenant', () => {
    expect(summary).toContain("import { context, json, audit } from '../_shared/security.ts'")
    expect(summary).toContain('const ctx = await context(req)')
  })

  it('busca agregados via RPC antes de qualquer chamada de IA', () => {
    const rpcIdx = summary.indexOf("client.rpc('radar_offer_aggregates'")
    const fetchIdx = summary.indexOf("fetch('https://api.openai.com")
    expect(rpcIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(rpcIdx)
  })

  it('nunca envia radar_offers cru para o modelo, apenas agregados_autorizados', () => {
    expect(summary).toContain('agregados_autorizados')
    expect(summary).not.toContain("from('radar_offers')")
  })

  it('instrui o modelo a nunca inventar preço, estoque, loja, país ou URL', () => {
    expect(summary).toContain('nunca invente preço, estoque, loja, país, URL')
  })

  it('degrada graciosamente sem chave de IA configurada', () => {
    expect(summary).toContain("Deno.env.get('OPENAI_API_KEY')")
    expect(summary).toContain('OPENAI_SECRET_MISSING')
  })

  it('sem ofertas, responde com resumo canônico e não chama a IA', () => {
    const zeroCheckIdx = summary.indexOf('total_offers ?? 0) === 0')
    const fetchIdx = summary.indexOf("fetch('https://api.openai.com")
    expect(zeroCheckIdx).toBeGreaterThan(-1)
    expect(zeroCheckIdx).toBeLessThan(fetchIdx)
  })
})
