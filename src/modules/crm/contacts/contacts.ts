import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization, currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { CONTACT_COLUMNS, toContact, type Contact, type ContactInput, type ContactRow } from './contact.types'

export async function fetchContacts(companyId?: string): Promise<Contact[]> {
  const { organizationId } = await authenticatedOrganization()
  let query = supabase!
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as ContactRow[]).map(toContact)
}

export async function fetchContact(contactId: string): Promise<Contact | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toContact(data as ContactRow) : null
}

/**
 * `company_id`/`customer_id` são validados contra a organização atual
 * por trigger no banco (contacts_validate_tenant_refs) — mesmo assim,
 * como não recebemos IDs arbitrários do usuário aqui além dos que a UI
 * já ofereceu (via EntityCombobox escopado por organização), essa
 * checagem é defesa em profundidade, não a única linha de defesa.
 */
export async function createContact(input: ContactInput): Promise<Contact> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('contacts')
    .insert({
      organization_id: organizationId,
      company_id: input.companyId || null,
      customer_id: input.customerId || null,
      name: input.name.trim(),
      normalized_name: input.name.trim().toLowerCase(),
      email: input.email || null,
      phone: input.phone || null,
      whatsapp_phone: input.whatsapp || null,
      role_title: input.roleTitle || null,
      is_primary: input.isPrimary ?? false,
      owner_user_id: input.ownerUserId || null,
      created_by: user.id,
    })
    .select(CONTACT_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toContact(data as ContactRow)
}

export async function updateContact(contactId: string, input: Partial<ContactInput>): Promise<Contact> {
  const { organizationId } = await currentOrganization()
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    patch.name = input.name.trim()
    patch.normalized_name = input.name.trim().toLowerCase()
  }
  if (input.companyId !== undefined) patch.company_id = input.companyId || null
  if (input.customerId !== undefined) patch.customer_id = input.customerId || null
  if (input.email !== undefined) patch.email = input.email || null
  if (input.phone !== undefined) patch.phone = input.phone || null
  if (input.whatsapp !== undefined) patch.whatsapp_phone = input.whatsapp || null
  if (input.roleTitle !== undefined) patch.role_title = input.roleTitle || null
  if (input.isPrimary !== undefined) patch.is_primary = input.isPrimary
  if (input.ownerUserId !== undefined) patch.owner_user_id = input.ownerUserId || null

  const { data, error } = await supabase!
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('organization_id', organizationId)
    .select(CONTACT_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toContact(data as ContactRow)
}
