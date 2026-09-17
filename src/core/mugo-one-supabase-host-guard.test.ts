import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão: URGENTE — GARANTIR QUE MUGÔ ONE NÃO CONSIGA
 * CONECTAR EM NENHUM SUPABASE LEGADO. Falha se o host antigo
 * (pfhvqkzafgoyumxmbwqc) ou "ruahparfums" aparecerem em qualquer
 * configuração runtime ATIVA (CSP, publicEnv, supabase client, core,
 * modules). Scripts operacionais (scripts/*.mjs, README, docs) não são
 * config runtime — não são varridos aqui, são catalogados no relatório.
 */

const LEGACY_HOST = 'pfhvqkzafgoyumxmbwqc'
const ALLOWED_HOST = 'otresxebmpfwqwawdsxh.supabase.co'

function readAll(path: string): string {
  return readFileSync(path, 'utf8')
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

describe('supabase host guard — zero conexão possível com infraestrutura legada', () => {
  it('vercel.json (CSP) não permite mais o host antigo, só o host Mugô One', () => {
    const vercelJson = readAll('vercel.json')
    expect(vercelJson).not.toContain(LEGACY_HOST)
    expect(vercelJson).toContain(`https://${ALLOWED_HOST}`)
    expect(vercelJson).toContain(`wss://${ALLOWED_HOST}`)
  })

  it('publicEnv.ts valida o host contra uma allowlist explícita e nunca cai em fallback', () => {
    const publicEnv = readAll('src/lib/publicEnv.ts')
    expect(publicEnv).toContain(`ALLOWED_SUPABASE_HOSTS = ['${ALLOWED_HOST}']`)
    expect(publicEnv).not.toContain(LEGACY_HOST)
    expect(publicEnv.toLowerCase()).not.toContain('ruahparfums')
    // "fail-closed": isConfigured depende do host estar na allowlist, não só de existir.
    expect(publicEnv).toContain('supabaseHostAllowed')
    expect(publicEnv).toContain('isConfigured: Boolean(supabaseUrl && supabasePublishableKey && supabaseHostAllowed)')
  })

  it('supabase.ts continua sendo a única fonte de createClient() no frontend', () => {
    const files = listFilesRecursive('src').filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    const clientCreators = files.filter((f) => {
      const content = readAll(f)
      return /createClient\s*\(\s*publicEnv|createClient\s*\(\s*[a-zA-Z]+\.supabaseUrl/.test(content) || (content.includes('@supabase/supabase-js') && content.includes('createClient('))
    })
    expect(clientCreators).toEqual(['src/lib/supabase.ts'])
  })

  it('nenhum arquivo de produção em src/core ou src/modules menciona o host antigo ou "ruahparfums"', () => {
    const files = [...listFilesRecursive('src/core'), ...listFilesRecursive('src/modules')].filter(
      (file) => !file.replace(/\\/g, '/').endsWith('.test.ts'),
    )
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const content = readAll(file).toLowerCase()
      expect(content, `${file} não pode conter "${LEGACY_HOST}"`).not.toContain(LEGACY_HOST.toLowerCase())
      expect(content, `${file} não pode conter "ruahparfums"`).not.toContain('ruahparfums')
    }
  })

  it('nenhum GitHub Actions workflow referencia o host antigo', () => {
    const workflows = (() => {
      try {
        return listFilesRecursive('.github/workflows')
      } catch {
        return []
      }
    })()
    for (const file of workflows) {
      expect(readAll(file)).not.toContain(LEGACY_HOST)
    }
  })
})
