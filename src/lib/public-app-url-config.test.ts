import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../supabase/functions/_shared/public-app-url.ts', import.meta.url), 'utf8')
const uploadFunction = readFileSync(
  new URL('../../supabase/functions/sale-payment-attachment-upload/index.ts', import.meta.url),
  'utf8',
)

describe('origens públicas permitidas — configurável por organização, sem regressão do default RUAH', () => {
  it('continua aceitando os domínios de produção e desenvolvimento por padrão, mesmo sem a nova variável', () => {
    expect(source).toContain("'https://crm.ruahparfums.com.br'")
    expect(source).toContain("'https://crmruahparfums.vercel.app'")
    expect(source).toContain("'http://localhost:5173'")
  })

  it('permite estender a lista de origens via variável de ambiente, sem alterar código', () => {
    expect(source).toContain('ADDITIONAL_ALLOWED_ORIGINS')
    expect(source).toContain("Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS')")
  })

  it('entradas inválidas em ADDITIONAL_ALLOWED_ORIGINS nunca derrubam a função (try/catch silencioso)', () => {
    expect(source).toMatch(/catch\{[^}]*ADDITIONAL_ALLOWED_ORIGINS[^}]*\}/)
  })

  it('sale-payment-attachment-upload usa o CORS compartilhado em vez de uma cópia local divergente', () => {
    expect(uploadFunction).toContain("from '../_shared/security.ts'")
    expect(uploadFunction).not.toContain('const allowedOrigins=new Set(')
  })
})
