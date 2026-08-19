import { authenticatedOrganization } from './records'
import { supabase } from './supabase'
import { Preset } from './permissions'

export type TeamMember = {
  user_id: string; full_name: string; email: string; role: 'admin'|'manager'|'operator'|'viewer'
  permission_preset: Preset; view_all: boolean; access_total: boolean; status: 'active'|'inactive'
  permission_overrides: number; created_at: string
}

export type PermissionOverride = { code: string; granted: boolean }

async function edgeFunctionError(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.clone().json()
    if (body?.error?.message) return String(body.error.message)
  } catch { /* resposta não JSON — usa a mensagem genérica abaixo */ }
  return 'Não foi possível concluir a operação.'
}

export async function fetchTeamMembers() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('team_members', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as TeamMember[]
}

export async function fetchTeamMemberPermissions(targetUserId: string) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('team_member_permissions', { org_id: organizationId, target_user_id: targetUserId })
  if (error) throw new Error(error.message)
  const granted = new Set<string>()
  for (const row of (data ?? []) as { permission_code: string; granted: boolean }[]) if (row.granted) granted.add(row.permission_code)
  return granted
}

export async function createTeamMember(input: {
  username: string; displayName: string; password: string; preset: Preset
  viewAll: boolean; accessTotal: boolean; overrides?: PermissionOverride[]
}) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.functions.invoke('admin-create-user', {
    body: {
      organization_id: organizationId, username: input.username, display_name: input.displayName,
      password: input.password, preset: input.preset, view_all: input.viewAll, access_total: input.accessTotal,
      overrides: input.overrides ?? [],
    },
  })
  if (error) throw new Error(await edgeFunctionError(error))
  if (data?.error) throw new Error(data.error.message)
  return data as { user_id: string; username: string }
}

export async function updateTeamMemberPermissions(input: {
  targetUserId: string; preset: Preset; viewAll: boolean; accessTotal: boolean; overrides?: PermissionOverride[]
}) {
  const { organizationId } = await authenticatedOrganization()
  const { error } = await supabase!.rpc('team_set_permissions', {
    p_organization_id: organizationId, p_target_user_id: input.targetUserId, p_preset: input.preset,
    p_view_all: input.viewAll, p_access_total: input.accessTotal, p_overrides: input.overrides ?? [],
  })
  if (error) throw new Error(error.message)
}

export async function setTeamMemberStatus(targetUserId: string, status: 'active'|'inactive') {
  const { organizationId } = await authenticatedOrganization()
  const { error } = await supabase!.rpc('team_set_status', { p_organization_id: organizationId, p_target_user_id: targetUserId, p_status: status })
  if (error) throw new Error(error.message)
}

export async function resetTeamMemberPassword(targetUserId: string, password: string) {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.functions.invoke('admin-reset-password', {
    body: { organization_id: organizationId, target_user_id: targetUserId, password },
  })
  if (error) throw new Error(await edgeFunctionError(error))
  if (data?.error) throw new Error(data.error.message)
}

/** Gerador de senha (briefing "SENHAS" — botão [GERAR SENHA]): legível, sem caracteres ambíguos (0/O, 1/l/I), sempre >=12 caracteres. */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(14)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}
