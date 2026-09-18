// Contrato universal do Fiscal Core (briefing §3). NENHUM conceito
// específico da Nuvem Fiscal pode vazar daqui para fora do adapter —
// o Core (RPCs, Edge Function fiscal-issue, frontend) só conhece esta
// interface. Trocar de provider no futuro (ex.: FocusNFeAdapter,
// briefing §65) significa escrever uma nova classe que implementa
// FiscalProvider — zero migration no Fiscal Core.

export type FiscalEnvironment = 'sandbox' | 'production'

export type FiscalInvoiceRequest = {
  environment: FiscalEnvironment
  issuer: Record<string, unknown>
  recipient: Record<string, unknown>
  items: { description: string; quantity: number; unitPrice: number; discountAmount: number; totalAmount: number; fiscalData: Record<string, unknown> }[]
  totalAmount: number
  externalId: string
}

export type FiscalProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean }

export type FiscalDocumentStatusResult = {
  providerDocumentId: string | null
  providerStatus: string
  status: 'processing' | 'authorized' | 'rejected' | 'failed'
  number: string | null
  series: string | null
  accessKey: string | null
}

export interface FiscalProvider {
  registerOrganization(profile: Record<string, unknown>): Promise<FiscalProviderResult<{ providerCompanyId: string }>>
  updateOrganization(providerCompanyId: string, profile: Record<string, unknown>): Promise<FiscalProviderResult<void>>

  issueServiceInvoice(request: FiscalInvoiceRequest): Promise<FiscalProviderResult<FiscalDocumentStatusResult>>

  getDocument(providerDocumentId: string): Promise<FiscalProviderResult<FiscalDocumentStatusResult>>
  refreshDocumentStatus(providerDocumentId: string): Promise<FiscalProviderResult<FiscalDocumentStatusResult>>

  cancelDocument(providerDocumentId: string, reason: string): Promise<FiscalProviderResult<void>>

  getPdf(providerDocumentId: string): Promise<FiscalProviderResult<{ url: string }>>
  getXml(providerDocumentId: string): Promise<FiscalProviderResult<{ url: string }>>

  healthCheck(): Promise<FiscalProviderResult<{ configured: boolean }>>
}
