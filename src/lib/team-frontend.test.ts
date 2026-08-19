import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Frontend/Edge-Function regression suite for the team/permissions
 * module. Same sandbox constraint as the rest of this session (no live
 * DOM render, no live Edge Function invocation) — these assert exact
 * source text. Live human validation is required (see final report).
 */

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const createUserFn = read('../supabase/functions/admin-create-user/index.ts')
const resetPasswordFn = read('../supabase/functions/admin-reset-password/index.ts')
const appTsx = read('App.tsx')
const sidebar = read('components/Sidebar.tsx')
const routing = read('routing.ts')
const teamPage = read('pages/TeamSettingsPage.tsx')
const teamLib = read('lib/team.ts')
const teamCss = read('pages/TeamSettingsPage.css')

describe('A — admin cria davi.vendas: a Edge Function faz exatamente os passos pedidos, na ordem', () => {
  it('autentica o caller pelo JWT (context()), resolve organização, verifica team.manage', () => {
    expect(createUserFn).toContain('const ctx = await context(req)')
    expect(createUserFn).toContain("permission_code: 'team.manage'")
  })
  it('canonicaliza o username e impede duplicado (o próprio Supabase Auth rejeita e-mail já existente — mapeado para username_taken)', () => {
    expect(createUserFn).toContain('normalizeUsername(body.username)')
    expect(createUserFn).toContain('username_taken')
  })
  it('cria o usuário no Auth com email_confirm=true (conta operacional interna, sem fluxo de confirmação por e-mail)', () => {
    expect(createUserFn).toContain('email_confirm: true')
  })
  it('cria membership + aplica preset/permissões via team_provision_member, e se isso falhar compensa apagando o auth user órfão', () => {
    expect(createUserFn).toContain("admin.rpc('team_provision_member'")
    const compensation = createUserFn.slice(createUserFn.indexOf('if (provisionError)'))
    expect(compensation).toContain('admin.auth.admin.deleteUser(created.user.id)')
  })
  it('nunca expõe a service_role key ao frontend — ela só existe dentro da Edge Function, lida de Deno.env', () => {
    expect(createUserFn).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
    expect(teamLib).not.toContain('SERVICE_ROLE')
    expect(teamLib).not.toContain('service_role')
  })
})

describe('V — rota direta sem permissão mostra ACESSO RESTRITO, nunca 404', () => {
  it('App.tsx checa a permissão da página ANTES de despachar qualquer componente de página, via can() (concede tudo automaticamente sob access_total — ver permissions-can.test.ts)', () => {
    expect(appTsx).toContain('return <AccessRestricted/>')
    expect(appTsx).toContain('pagePermission[page].some((code) => can(code))')
  })
  it('Configurações tem checagem própria por aba (Frete=settings.view, Equipe=team.view OU team.manage) — não é só o gate genérico da página', () => {
    const configBlock = appTsx.slice(appTsx.indexOf("if (page === 'Configurações')"), appTsx.indexOf('if (!permissionsLoading && !pagePermission'))
    expect(configBlock).toContain("can('team.view') || can('team.manage')")
    expect(configBlock).toContain("can('settings.view')")
  })
})

describe('W — menu esconde módulo proibido', () => {
  it('Sidebar filtra a navegação pela mesma tabela pagePermission usada nas rotas — uma única fonte de verdade, não duas listas divergentes — via can()', () => {
    expect(sidebar).toContain('pagePermission[label].some((code) => can(code))')
    expect(routing).toContain('export const pagePermission')
  })
  it('enquanto carrega, nada extra aparece (nunca mostra tudo e depois esconde, o que pareceria um bug)', () => {
    expect(sidebar).toContain('loading ? [] :')
  })
})

describe('X — reset de senha nunca revela a senha anterior', () => {
  it('admin-reset-password só ESCREVE uma senha nova via Admin API — nunca lê/retorna a senha atual em lugar nenhum', () => {
    expect(resetPasswordFn).toContain('admin.auth.admin.updateUserById(targetUserId, { password })')
    expect(resetPasswordFn).not.toContain('getUserById')
    // nenhuma resposta HTTP jamais inclui a chave/valor "password" — só o
    // código de erro 'invalid_password' (nome, não valor) é permitido.
    expect(resetPasswordFn).not.toMatch(/password\s*[:,]\s*password/)
    expect(resetPasswordFn).not.toContain('password:')
  })
  it('a UI de edição só tem "Redefinir senha" (campo para senha NOVA) — nenhum botão "ver senha" existe para um usuário já criado', () => {
    expect(teamPage).toContain('Redefinir senha')
    expect(teamPage).not.toContain('Ver senha')
    expect(teamPage).not.toContain('mostrar senha atual')
  })
})

describe('Y — copiar permissões de outro usuário funciona', () => {
  it('applyCopyFrom busca o preset/flags/permissões REAIS do usuário de origem (via fetchTeamMemberPermissions), não um preset genérico', () => {
    expect(teamPage).toContain('const applyCopyFrom = async (userId: string)')
    expect(teamPage).toContain('setChecked(await fetchTeamMemberPermissions(userId)')
    expect(teamPage).toContain('setPreset(source.permission_preset)')
    expect(teamPage).toContain('setViewAll(source.view_all)')
    expect(teamPage).toContain('setAccessTotal(source.access_total)')
  })
})

describe('Z — mobile 390px sem overflow', () => {
  it('a grade de cartões de equipe vira coluna única em telas pequenas', () => {
    expect(teamCss).toContain('@media (max-width: 480px)')
    expect(teamCss).toMatch(/\.team-grid \{ grid-template-columns: 1fr; \}/)
  })
  it('nenhuma largura fixa maior que a viewport-alvo nos containers principais', () => {
    expect(teamCss).not.toMatch(/(?<!max-|min-)width:\s*[4-9]\d{2}px/)
  })
  it('checkboxes de permissão continuam com alvo de toque >=44px', () => {
    expect(teamCss).toContain('min-height: 44px')
  })
})

describe('atalhos MARCAR TUDO / SOMENTE VISUALIZAÇÃO / LIMPAR existem e usam o catálogo real, não uma lista inventada', () => {
  it('markAll usa todos os códigos do catálogo, onlyView filtra por sufixo .view, clearAll esvazia', () => {
    expect(teamPage).toContain('const markAll = () => setChecked(new Set(PERMISSION_CATALOG.map((entry) => entry.code)))')
    expect(teamPage).toContain("entry.code.endsWith('.view')")
    expect(teamPage).toContain('const clearAll = () => setChecked(new Set())')
  })
})
