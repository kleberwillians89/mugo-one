import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

export type FiscalDocumentType = 'nfse' | 'nfe' | 'nfce'
export type FiscalDocumentStatus = 'draft' | 'requested' | 'processing' | 'authorized' | 'rejected' | 'cancelled' | 'failed'
export type FiscalEnvironment = 'sandbox' | 'production'

export const FISCAL_DOCUMENT_TYPE_LABEL: Record<FiscalDocumentType, string> = { nfse: 'NFS-e', nfe: 'NF-e', nfce: 'NFC-e' }
export const FISCAL_STATUS_LABEL: Record<FiscalDocumentStatus, string> = {
  draft: 'Rascunho', requested: 'Solicitada', processing: 'Processando', authorized: 'Autorizada',
  rejected: 'Rejeitada', cancelled: 'Cancelada', failed: 'Falhou',
}

export type FiscalDocument = {
  id: string
  saleId: string | null
  documentType: FiscalDocumentType
  environment: FiscalEnvironment
  status: FiscalDocumentStatus
  number: string | null
  series: string | null
  accessKey: string | null
  totalAmount: number
  issuedAt: string | null
  authorizedAt: string | null
  cancelledAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

type FiscalDocumentRow = {
  id: string; sale_id: string | null; document_type: FiscalDocumentType; environment: FiscalEnvironment; status: FiscalDocumentStatus
  number: string | null; series: string | null; access_key: string | null; total_amount: number
  issued_at: string | null; authorized_at: string | null; cancelled_at: string | null
  error_code: string | null; error_message: string | null; created_at: string
}

const FISCAL_DOCUMENT_COLUMNS = 'id,sale_id,document_type,environment,status,number,series,access_key,total_amount,issued_at,authorized_at,cancelled_at,error_code,error_message,created_at'

function mapDocument(row: FiscalDocumentRow): FiscalDocument {
  return {
    id: row.id, saleId: row.sale_id, documentType: row.document_type, environment: row.environment, status: row.status,
    number: row.number, series: row.series, accessKey: row.access_key, totalAmount: row.total_amount,
    issuedAt: row.issued_at, authorizedAt: row.authorized_at, cancelledAt: row.cancelled_at,
    errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at,
  }
}

export async function fetchFiscalDocuments(filters: { status?: FiscalDocumentStatus[]; documentType?: FiscalDocumentType } = {}): Promise<FiscalDocument[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  let query = supabase.from('fiscal_documents').select(FISCAL_DOCUMENT_COLUMNS).eq('organization_id', organizationId)
  if (filters.status?.length) query = query.in('status', filters.status)
  if (filters.documentType) query = query.eq('document_type', filters.documentType)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapDocument)
}

export async function fetchFiscalDocumentsForSale(saleId: string): Promise<FiscalDocument[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('fiscal_documents').select(FISCAL_DOCUMENT_COLUMNS).eq('sale_id', saleId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapDocument)
}

export type FiscalDocumentDetail = FiscalDocument & {
  recipientSnapshot: Record<string, unknown>
  issuerSnapshot: Record<string, unknown>
  items: { description: string; quantity: number; unit: string; unitPrice: number; totalAmount: number }[]
}

export async function fetchFiscalDocument(id: string): Promise<FiscalDocumentDetail> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.from('fiscal_documents').select(`${FISCAL_DOCUMENT_COLUMNS},recipient_snapshot,issuer_snapshot`).eq('id', id).single()
  if (error) throw new Error(error.message)
  const { data: items, error: itemsError } = await supabase.from('fiscal_document_items').select('description,quantity,unit,unit_price,total_amount').eq('fiscal_document_id', id).order('position')
  if (itemsError) throw new Error(itemsError.message)
  const row = data as FiscalDocumentRow & { recipient_snapshot: Record<string, unknown>; issuer_snapshot: Record<string, unknown> }
  return {
    ...mapDocument(row), recipientSnapshot: row.recipient_snapshot, issuerSnapshot: row.issuer_snapshot,
    items: (items ?? []).map((item: { description: string; quantity: number; unit: string; unit_price: number; total_amount: number }) => ({
      description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unit_price, totalAmount: item.total_amount,
    })),
  }
}

export async function requestFiscalDocument(saleId: string, documentType: FiscalDocumentType = 'nfse'): Promise<{ fiscalDocumentId: string; status: string; alreadyRequested: boolean }> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.functions.invoke('fiscal-request', { body: { organization_id: organizationId, sale_id: saleId, document_type: documentType } })
  if (error) throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? error.message)
  const result = data as { data?: { fiscal_document_id: string; status: string; already_requested: boolean }; error?: { code: string; message: string } }
  if (result.error) throw new Error(result.error.message)
  if (!result.data) throw new Error('Não foi possível solicitar o documento fiscal.')
  return { fiscalDocumentId: result.data.fiscal_document_id, status: result.data.status, alreadyRequested: result.data.already_requested }
}

export async function cancelFiscalDocument(id: string, reason?: string): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { error } = await supabase.rpc('cancel_fiscal_document', { p_fiscal_document_id: id, p_reason: reason ?? null })
  if (error) throw new Error(error.message)
}

export type OrganizationFiscalProfile = {
  stateRegistration: string | null
  municipalRegistration: string | null
  taxRegime: string | null
  addressLine: string | null
  addressNumber: string | null
  district: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  cityCode: string | null
  nfseEnabled: boolean
  nfeEnabled: boolean
  nfceEnabled: boolean
  defaultEnvironment: FiscalEnvironment
}

type ProfileRow = {
  state_registration: string | null; municipal_registration: string | null; tax_regime: string | null
  address_line: string | null; address_number: string | null; district: string | null; city: string | null; state: string | null; postal_code: string | null; city_code: string | null
  nfse_enabled: boolean; nfe_enabled: boolean; nfce_enabled: boolean; default_environment: FiscalEnvironment
}

const PROFILE_COLUMNS = 'state_registration,municipal_registration,tax_regime,address_line,address_number,district,city,state,postal_code,city_code,nfse_enabled,nfe_enabled,nfce_enabled,default_environment'

function mapProfile(row: ProfileRow): OrganizationFiscalProfile {
  return {
    stateRegistration: row.state_registration, municipalRegistration: row.municipal_registration, taxRegime: row.tax_regime,
    addressLine: row.address_line, addressNumber: row.address_number, district: row.district, city: row.city, state: row.state, postalCode: row.postal_code, cityCode: row.city_code,
    nfseEnabled: row.nfse_enabled, nfeEnabled: row.nfe_enabled, nfceEnabled: row.nfce_enabled, defaultEnvironment: row.default_environment,
  }
}

export async function fetchOrganizationFiscalProfile(): Promise<OrganizationFiscalProfile | null> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('organization_fiscal_profiles').select(PROFILE_COLUMNS).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapProfile(data as ProfileRow) : null
}

export async function saveOrganizationFiscalProfile(input: Partial<OrganizationFiscalProfile>): Promise<OrganizationFiscalProfile> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const payload: Record<string, unknown> = { organization_id: organizationId }
  if (input.stateRegistration !== undefined) payload.state_registration = input.stateRegistration
  if (input.municipalRegistration !== undefined) payload.municipal_registration = input.municipalRegistration
  if (input.taxRegime !== undefined) payload.tax_regime = input.taxRegime
  if (input.addressLine !== undefined) payload.address_line = input.addressLine
  if (input.addressNumber !== undefined) payload.address_number = input.addressNumber
  if (input.district !== undefined) payload.district = input.district
  if (input.city !== undefined) payload.city = input.city
  if (input.state !== undefined) payload.state = input.state
  if (input.postalCode !== undefined) payload.postal_code = input.postalCode
  if (input.cityCode !== undefined) payload.city_code = input.cityCode
  if (input.nfseEnabled !== undefined) payload.nfse_enabled = input.nfseEnabled
  if (input.defaultEnvironment !== undefined) payload.default_environment = input.defaultEnvironment

  const { data, error } = await supabase.from('organization_fiscal_profiles').upsert(payload, { onConflict: 'organization_id' }).select(PROFILE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return mapProfile(data as ProfileRow)
}

export type FiscalConnection = { id: string; provider: string; status: 'not_configured' | 'connected' | 'error'; environment: FiscalEnvironment }

export async function fetchFiscalConnection(): Promise<FiscalConnection | null> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('fiscal_connections').select('id,provider,status,environment').eq('organization_id', organizationId).eq('provider', 'nuvem_fiscal').maybeSingle()
  if (error) throw new Error(error.message)
  return data as FiscalConnection | null
}
