import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do hotfix "desacoplar completamente Mugô One da
 * RUAH". Cobre só as áreas GLOBAIS/CORE do produto (Auth/App/Sidebar/
 * Header/permissions/core/modules) — não a aplicação inteira. Módulos
 * legados (src/lib/*, src/pages/* operacionais, src/portal/*,
 * migrations históricas) continuam podendo referenciar RUAH como
 * adapter/regra operacional legado; isso é esperado e catalogado, não
 * um bug. Ver relatório de entrega para a lista completa.
 */

const GLOBAL_FILES = [
  'src/Auth.tsx',
  'src/App.tsx',
  'src/routing.ts',
  'src/components/Sidebar.tsx',
  'src/components/Header.tsx',
  'src/lib/permissions.ts',
]

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

describe('decoupling guard — RUAH não pode vazar para as áreas globais/core do produto', () => {
  it('nenhum arquivo global referencia ruahparfums.com.br ou RUAH_ORGANIZATION_ID', () => {
    for (const file of GLOBAL_FILES) {
      const content = readAll(file)
      expect(content.toLowerCase(), `${file} não pode conter "ruahparfums"`).not.toContain('ruahparfums')
      expect(content, `${file} não pode conter RUAH_ORGANIZATION_ID`).not.toContain('RUAH_ORGANIZATION_ID')
    }
  })

  it('nenhum arquivo em src/core ou src/modules referencia ruahparfums, RUAH_ORGANIZATION_ID ou RUAH como marca', () => {
    // Exclui este próprio arquivo — ele PRECISA mencionar essas palavras
    // nas descrições dos testes e nas mensagens de asserção para
    // documentar o que está proibido, o que geraria um falso positivo
    // contra si mesmo.
    const self = 'src/core/mugo-one-decoupling.test.ts'
    const files = [...listFilesRecursive('src/core'), ...listFilesRecursive('src/modules')].filter(
      (file) => !file.replace(/\\/g, '/').endsWith(self),
    )
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      const content = readAll(file)
      expect(content.toLowerCase(), `${file} não pode conter "ruahparfums"`).not.toContain('ruahparfums')
      expect(content, `${file} não pode conter RUAH_ORGANIZATION_ID`).not.toContain('RUAH_ORGANIZATION_ID')
      // "ruah" sozinho é permitido só dentro de asserções de teste que
      // verificam a AUSÊNCIA da palavra (ex: crm-tenant-isolation.test.ts,
      // crm-commercial-foundation.test.ts) — nunca como valor/branding.
      if (/\bruah\b/i.test(content) && !file.endsWith('.test.ts')) {
        throw new Error(`${file} referencia "ruah" fora de um teste de regressão — revisar`)
      }
    }
  })

  it('domínio de login global é genérico do produto (acesso.mugo.one), nunca ruahparfums', () => {
    const permissions = readAll('src/lib/permissions.ts')
    expect(permissions).toContain("INTERNAL_LOGIN_DOMAIN = 'acesso.mugo.one'")
    expect(permissions.toLowerCase()).not.toContain('ruahparfums')
  })

  it('a Edge Function de criação de usuário usa o mesmo domínio genérico', () => {
    const fn = readAll('supabase/functions/admin-create-user/index.ts')
    expect(fn).toContain("INTERNAL_DOMAIN = 'acesso.mugo.one'")
    expect(fn.toLowerCase()).not.toContain('ruahparfums')
  })

  it('storage keys novas (mugo_one_remember/mugo_one_session) são as únicas escritas — nunca mais grava a chave antiga', () => {
    const auth = readAll('src/Auth.tsx')
    expect(auth).toContain('localStorage.setItem(REMEMBER_KEY')
    expect(auth).toContain("sessionStorage.setItem(SESSION_KEY,'active')")
    expect(auth).not.toMatch(/setItem\(\s*['"]ruah_remember['"]/)
    expect(auth).not.toMatch(/setItem\(\s*['"]ruah_session['"]/)

    const queue = readAll('src/pages/FaltaSplitarPage.tsx')
    expect(queue).toContain("sessionStorage.setItem('mugo_one_session','active')")
    expect(queue).not.toContain('ruah_session')
  })

  it('a chave antiga só existe como fallback de leitura documentado (compat temporária), nunca como escrita', () => {
    const auth = readAll('src/Auth.tsx')
    expect(auth).toContain("localStorage.getItem('ruah_remember')")
    expect(auth).toContain("sessionStorage.getItem('ruah_session')")
    expect(auth).toContain('compatibilidade temporária de leitura')
  })

  it('/portal é aceito como rota do customer portal ao lado de /minha-ruah (alias documentado, não removido)', () => {
    const auth = readAll('src/Auth.tsx')
    expect(auth).toContain("path.startsWith('/minha-ruah')||path.startsWith('/portal')")
    expect(auth).toContain('alias de compatibilidade')
    expect(auth).toContain('rota canônica do produto')
  })

  it('sidebar mostra organização e papel reais via OrganizationProvider — nunca "Mugô One / Administrador" hardcoded', () => {
    const sidebar = readAll('src/components/Sidebar.tsx')
    expect(sidebar).toContain("from '../core/organizations/useOrganization'")
    expect(sidebar).toContain('currentOrganization?.organizationName')
    expect(sidebar).toContain('currentOrganization.role')
    expect(sidebar).not.toContain('<strong>Mugô One</strong><span>Administrador</span>')
  })

  it('nenhum arquivo global usa can()=true, desliga RLS ou remove permission gate como bypass', () => {
    for (const file of ['src/App.tsx', 'src/components/Sidebar.tsx']) {
      const content = readAll(file)
      expect(content).not.toMatch(/can\s*=\s*\(\)\s*=>\s*true/)
      expect(content).not.toContain('disable row level security')
    }
  })
})
