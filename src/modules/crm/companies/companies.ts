import { supabase } from '../../../lib/supabase'
import { authenticatedOrganization, currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { normalizeClient } from '../../../lib/importer'
import { COMPANY_COLUMNS, toCompany, type Company, type CompanyInput, type CompanyRow } from './company.types'

export async function fetchCompanies(): Promise<Company[]> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('companies')
    .select(COMPANY_COLUMNS)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as CompanyRow[]).map(toCompany)
}

export async function fetchCompany(companyId: string): Promise<Company | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('companies')
    .select(COMPANY_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', companyId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toCompany(data as CompanyRow) : null
}

export async function createCompany(input: CompanyInput): Promise<Company> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('companies')
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      normalized_name: normalizeClient(input.name),
      legal_name: input.legalName || null,
      document: input.document || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      industry: input.industry || null,
      company_size: input.companySize || null,
      address_line: input.addressLine || null,
      address_number: input.addressNumber || null,
      complement: input.complement || null,
      district: input.district || null,
      city: input.city || null,
      state: input.state || null,
      postal_code: input.postalCode || null,
      country: input.country || 'BR',
      owner_user_id: input.ownerUserId || null,
      status: input.status || 'active',
      source_channel: input.sourceChannel || null,
      source_campaign: input.sourceCampaign || null,
      source_medium: input.sourceMedium || null,
      source_external_id: input.sourceExternalId || null,
      created_by: user.id,
    })
    .select(COMPANY_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toCompany(data as CompanyRow)
}

export async function updateCompany(companyId: string, input: Partial<CompanyInput>): Promise<Company> {
  const { organizationId } = await currentOrganization()
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    patch.name = input.name.trim()
    patch.normalized_name = normalizeClient(input.name)
  }
  if (input.legalName !== undefined) patch.legal_name = input.legalName || null
  if (input.document !== undefined) patch.document = input.document || null
  if (input.email !== undefined) patch.email = input.email || null
  if (input.phone !== undefined) patch.phone = input.phone || null
  if (input.website !== undefined) patch.website = input.website || null
  if (input.industry !== undefined) patch.industry = input.industry || null
  if (input.companySize !== undefined) patch.company_size = input.companySize || null
  if (input.addressLine !== undefined) patch.address_line = input.addressLine || null
  if (input.addressNumber !== undefined) patch.address_number = input.addressNumber || null
  if (input.complement !== undefined) patch.complement = input.complement || null
  if (input.district !== undefined) patch.district = input.district || null
  if (input.city !== undefined) patch.city = input.city || null
  if (input.state !== undefined) patch.state = input.state || null
  if (input.postalCode !== undefined) patch.postal_code = input.postalCode || null
  if (input.country !== undefined) patch.country = input.country || 'BR'
  if (input.ownerUserId !== undefined) patch.owner_user_id = input.ownerUserId || null
  if (input.status !== undefined) patch.status = input.status || 'active'
  if (input.sourceChannel !== undefined) patch.source_channel = input.sourceChannel || null
  if (input.sourceCampaign !== undefined) patch.source_campaign = input.sourceCampaign || null
  if (input.sourceMedium !== undefined) patch.source_medium = input.sourceMedium || null
  if (input.sourceExternalId !== undefined) patch.source_external_id = input.sourceExternalId || null

  const { data, error } = await supabase!
    .from('companies')
    .update(patch)
    .eq('id', companyId)
    .eq('organization_id', organizationId)
    .select(COMPANY_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toCompany(data as CompanyRow)
}
