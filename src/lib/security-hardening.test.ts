import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('hardening de entrega', () => {
  it('limita endpoints públicos antes de gerar links ou consultar identidade', () => {
    for (const file of ['../supabase/functions/customer-registration-start/index.ts', '../supabase/functions/customer-claim-start/index.ts']) {
      const source = read(file)
      expect(source).toContain('publicRateLimit')
      expect(source).toContain('serviceRoleKey')
      expect(source).toContain('.ip')
      expect(source).toMatch(/includeAddress\s*:\s*false/)
    }
  })

  it('rate limiter só pode ser executado pelo service_role e sua tabela não é pública', () => {
    const sql = read('../supabase/migrations/202609160005_public_endpoint_rate_limits.sql')
    expect(sql).toContain("auth.role() <> 'service_role'")
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('revoke all on table public.public_endpoint_rate_limits from anon, authenticated')
    expect(sql).toContain('grant execute on function public.consume_public_endpoint_rate_limit(text,text,integer,integer) to service_role')
  })

  it('Vercel envia CSP, anti-frame, nosniff e HSTS', () => {
    const config = JSON.parse(read('../vercel.json'))
    const headers = config.headers.flatMap((rule: {headers: Array<{key:string}>}) => rule.headers.map(header => header.key))
    expect(headers).toEqual(expect.arrayContaining(['Content-Security-Policy','X-Frame-Options','X-Content-Type-Options','Strict-Transport-Security']))
  })
})
