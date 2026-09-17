import { supabase } from './supabase'

/**
 * Login por usuário (briefing "LOGIN POR USUÁRIO"): a empresa nunca
 * precisa inventar um e-mail real para cada funcionário. "davi.vendas"
 * vira, só internamente, davi.vendas@acesso.mugo.one — a pessoa nunca
 * precisa saber disso. Mesma constante/regra usada na Edge Function
 * admin-create-user (duplicada de propósito: um é Deno, outro é browser,
 * sem módulo compartilhado entre os dois runtimes neste projeto).
 *
 * Este é o fallback genérico do PRODUTO, não de um tenant específico —
 * nenhuma organização deve ser hardcoded aqui. Domínio próprio por
 * organização (ex: acesso.empresaa.com) é objetivo futuro, a ser lido de
 * organization_settings.settings quando existir; até lá, contas
 * internas de qualquer organização usam este mesmo domínio genérico.
 */
export const INTERNAL_LOGIN_DOMAIN = 'acesso.mugo.one'
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

/** "davi.vendas" → e-mail interno. "alguem@dominio.com" passa direto — preserva login de contas antigas por e-mail real. */
export function normalizeLoginIdentifier(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value || value.includes('@')) return value
  return `${value}@${INTERNAL_LOGIN_DOMAIN}`
}

export function isValidUsername(raw: string): boolean {
  return USERNAME_RE.test(raw.trim().toLowerCase())
}

/** Se o usuário digitar o e-mail interno por engano em algum lugar de exibição, isto o traduz de volta ao nome de usuário curto. Nunca usado para login — só para nunca vazar o domínio interno na UI. */
export function usernameFromEmail(email: string): string {
  return email.toLowerCase().endsWith(`@${INTERNAL_LOGIN_DOMAIN}`) ? email.slice(0, -(INTERNAL_LOGIN_DOMAIN.length + 1)) : email
}

export type MembershipFlags = { status: string; accessTotal: boolean; viewAll: boolean }

/**
 * Lido direto de organization_members (select simples, RLS já permite o
 * próprio membro ler sua linha — memberships_select) — não uma RPC nova,
 * não mexe em backend. Serve como camada de robustez independente de
 * my_permission_summary: se por qualquer motivo o conjunto de códigos
 * concedidos vier incompleto/desatualizado num instante, o flag bruto
 * access_total ainda garante "vê tudo" imediatamente, sem depender de
 * nenhum código individual ter chegado certo no Set.
 */
export async function fetchMyMembershipFlags(organizationId: string): Promise<MembershipFlags | null> {
  const { data: { user } } = await supabase!.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase!
    .from('organization_members')
    .select('status,access_total,view_all')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !data) return null
  return { status: String(data.status), accessTotal: Boolean(data.access_total), viewAll: Boolean(data.view_all) }
}

const VIEW_ALL_EXCLUDED = new Set(['team.view', 'audit.view'])

/**
 * Espelha, no frontend, a MESMA ordem de resolução de has_org_permission
 * (backend, fonte real de autoridade — isto aqui nunca autoriza uma
 * escrita sozinho). access_total concede qualquer código, sem exceção —
 * "REGRA OBRIGATÓRIA": nunca depende do conjunto plano ter aquele código
 * específico. view_all concede *.view, exceto team.view/audit.view
 * (mesma exceção do backend). Sem flags carregados (fetch falhou, ou
 * ainda não chegou), cai no conjunto plano — nunca finge access_total
 * quando não sabe.
 */
export function computeCan(code: string, flags: MembershipFlags | null, granted: Set<string>): boolean {
  // Mesma ordem do backend: status inativo nega tudo primeiro, antes de
  // sequer olhar access_total — um access_total=true numa linha inativa
  // (ex.: alguém desativado enquanto ainda tinha o flag ligado) nunca
  // deve passar por aqui.
  if (flags?.status !== 'active') return granted.has(code)
  if (flags.accessTotal) return true
  if (flags.viewAll && code.endsWith('.view') && !VIEW_ALL_EXCLUDED.has(code)) return true
  return granted.has(code)
}

export async function fetchMyPermissions(organizationId: string): Promise<Set<string>> {
  const { data, error } = await supabase!.rpc('my_permission_summary', { org_id: organizationId })
  if (error) throw new Error(error.message)
  const granted = new Set<string>()
  for (const row of (data ?? []) as { permission_code: string; granted: boolean }[]) {
    if (row.granted) granted.add(row.permission_code)
  }
  return granted
}

export type Preset = 'administrador' | 'gestor' | 'comercial' | 'entregas' | 'estoque' | 'visualizacao' | 'personalizado'

export const PRESET_LABEL: Record<Preset, string> = {
  administrador: 'Administrador', gestor: 'Gestor', comercial: 'Comercial', entregas: 'Entregas / Logística',
  estoque: 'Estoque', visualizacao: 'Visualização', personalizado: 'Personalizado',
}

/** Defaults sensatos de VER TUDO/ACESSO TOTAL ao escolher um preset na UI — só um ponto de partida, os dois checkboxes continuam editáveis depois. */
export const PRESET_DEFAULT_FLAGS: Record<Preset, { viewAll: boolean; accessTotal: boolean }> = {
  administrador: { viewAll: true, accessTotal: true },
  gestor: { viewAll: true, accessTotal: false },
  comercial: { viewAll: false, accessTotal: false },
  entregas: { viewAll: false, accessTotal: false },
  estoque: { viewAll: false, accessTotal: false },
  visualizacao: { viewAll: true, accessTotal: false },
  personalizado: { viewAll: false, accessTotal: false },
}

/**
 * Catálogo de permissões espelhado do SQL (public.permissions, migration
 * 202608190011) — auditado contra rotas/RPCs reais. Ver
 * src/lib/permissions-catalog.test.ts para a checagem de que este espelho
 * nunca diverge da migration.
 */
export type PermissionCatalogEntry = { code: string; module: string; label: string }

export const PERMISSION_MODULE_LABEL: Record<string, string> = {
  dashboard: 'Painel', clients: 'Clientes', sales: 'Vendas', inventory: 'Estoque', shipping: 'Envios',
  radar: 'Radar', waitlist: 'Lista de espera', recovery: 'Recuperação de clientes', cost_margin: 'Custo e margem',
  reports: 'Relatórios', ai_import: 'Importação com IA', tasks: 'Tarefas', audit: 'Auditoria', settings: 'Configurações', team: 'Equipe',
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  { code: 'dashboard.view', module: 'dashboard', label: 'Visualizar painel' },
  { code: 'clients.view', module: 'clients', label: 'Visualizar clientes' },
  { code: 'clients.create', module: 'clients', label: 'Cadastrar clientes' },
  { code: 'clients.edit', module: 'clients', label: 'Editar clientes' },
  { code: 'clients.export', module: 'clients', label: 'Exportar clientes' },
  { code: 'sales.view', module: 'sales', label: 'Visualizar vendas' },
  { code: 'sales.create', module: 'sales', label: 'Criar vendas' },
  { code: 'sales.edit', module: 'sales', label: 'Editar vendas' },
  { code: 'sales.validate', module: 'sales', label: 'Validar vendas' },
  { code: 'sales.cancel', module: 'sales', label: 'Cancelar vendas' },
  { code: 'inventory.view', module: 'inventory', label: 'Visualizar estoque' },
  { code: 'inventory.create', module: 'inventory', label: 'Cadastrar estoque' },
  { code: 'inventory.adjust', module: 'inventory', label: 'Ajustar saldo físico' },
  { code: 'inventory.identity', module: 'inventory', label: 'Gerar identidade física (frasco)' },
  { code: 'inventory.print', module: 'inventory', label: 'Imprimir etiqueta' },
  { code: 'inventory.scan', module: 'inventory', label: 'Ler código (câmera/scanner/manual)' },
  { code: 'inventory.conference', module: 'inventory', label: 'Conferir frasco' },
  { code: 'inventory.split', module: 'inventory', label: 'Criar split' },
  { code: 'shipping.view', module: 'shipping', label: 'Visualizar envios' },
  { code: 'shipping.prepare', module: 'shipping', label: 'Preparar separação' },
  { code: 'shipping.scan', module: 'shipping', label: 'Bipar frasco/split na separação' },
  { code: 'shipping.label', module: 'shipping', label: 'Gerenciar etiqueta de envio' },
  { code: 'shipping.post', module: 'shipping', label: 'Postar envio' },
  { code: 'radar.view', module: 'radar', label: 'Visualizar radar' },
  { code: 'radar.search', module: 'radar', label: 'Buscar no radar' },
  { code: 'radar.manage_suppliers', module: 'radar', label: 'Gerenciar fornecedores do radar' },
  { code: 'radar.manage_offers', module: 'radar', label: 'Gerenciar ofertas do radar' },
  { code: 'waitlist.view', module: 'waitlist', label: 'Visualizar lista de espera' },
  { code: 'waitlist.manage', module: 'waitlist', label: 'Gerenciar lista de espera' },
  { code: 'recovery.view', module: 'recovery', label: 'Visualizar recuperação de clientes' },
  { code: 'recovery.manage', module: 'recovery', label: 'Gerenciar recuperação de clientes' },
  { code: 'cost_margin.view', module: 'cost_margin', label: 'Visualizar custo e margem' },
  { code: 'cost_margin.edit', module: 'cost_margin', label: 'Editar custo' },
  { code: 'reports.view', module: 'reports', label: 'Visualizar relatórios' },
  { code: 'reports.export', module: 'reports', label: 'Exportar relatórios' },
  { code: 'ai_import.view', module: 'ai_import', label: 'Visualizar importação IA' },
  { code: 'ai_import.execute', module: 'ai_import', label: 'Executar importação IA' },
  { code: 'ai_import.confirm', module: 'ai_import', label: 'Confirmar importação IA' },
  { code: 'tasks.sales', module: 'tasks', label: 'Tarefas de vendas' },
  { code: 'tasks.split', module: 'tasks', label: 'Tarefas de split' },
  { code: 'tasks.shipping', module: 'tasks', label: 'Tarefas de entregas' },
  { code: 'tasks.management', module: 'tasks', label: 'Tarefas de gestão' },
  { code: 'audit.view', module: 'audit', label: 'Visualizar auditoria' },
  { code: 'settings.view', module: 'settings', label: 'Visualizar configurações' },
  { code: 'team.view', module: 'team', label: 'Visualizar equipe' },
  { code: 'team.manage', module: 'team', label: 'Gerenciar usuários e permissões' },
]
