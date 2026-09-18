import { FiscalDocumentStatusResult, FiscalInvoiceRequest, FiscalProvider, FiscalProviderResult } from './fiscal-provider.ts'

// NuvemFiscalAdapter — implementação de REFERÊNCIA, não verificada
// ponta a ponta (ver docs/FISCAL_MIGRATION_PLAN.md §0).
//
// A Nuvem Fiscal anunciou desativação do serviço em 22/04/2026, com
// desligamento em 31/07/2026 — já ocorrido na data desta sprint
// (2026-09-18). nuvemfiscal.com.br e dev.nuvemfiscal.com.br não
// resolvem mais por DNS; não há sandbox nem produção reais para
// confirmar contra a documentação atual. Esta classe implementa:
//
// (a) CONFIRMADO antes do desligamento (via cache de busca — nunca
//     fetch direto, já que os domínios não existem mais):
//     - Autenticação OAuth2, fluxo client_credentials.
//     - Header "Authorization: Bearer <token>".
//     - client_id/client_secret do console da própria Nuvem Fiscal.
//     - Chamadas de NFS-e exigem token com scope=nfse.
//     - Emissão exige cadastro prévio de empresa + certificado
//       digital + configuração municipal.
//
// (b) NÃO confirmado (docs inacessíveis): paths exatos de endpoint,
//     schema exato de request/response, formato de erro, existência
//     de webhook. Os métodos abaixo que dependeriam disso retornam
//     PROVIDER_NOT_VERIFIED de forma explícita, em vez de inventar um
//     contrato HTTP que nunca foi confirmado contra a documentação
//     real — nunca finge sucesso (briefing §81).
//
// Quando um provider real e ativo for escolhido (Focus NFe é a
// recomendação da própria Nuvem Fiscal, e já citada no briefing como
// futuro adapter — §65), a substituição é só uma nova classe
// implementando FiscalProvider — o Fiscal Core não muda.

const NOT_VERIFIED: FiscalProviderResult<never> = {
  ok: false, errorCode: 'PROVIDER_NOT_VERIFIED',
  errorMessage: 'Nuvem Fiscal foi desativada (comunicado de 22/04/2026, desligamento em 31/07/2026) — contrato de request/response nunca confirmado contra documentação viva. Ver docs/FISCAL_MIGRATION_PLAN.md §0.',
  retryable: false,
}

export class NuvemFiscalAdapter implements FiscalProvider {
  constructor(private readonly config: { clientId?: string; clientSecret?: string; baseUrl?: string }) {}

  private async fetchAccessToken(): Promise<FiscalProviderResult<string>> {
    if (!this.config.clientId || !this.config.clientSecret) {
      return { ok: false, errorCode: 'PROVIDER_NOT_CONFIGURED', errorMessage: 'Credenciais da Nuvem Fiscal não configuradas.', retryable: false }
    }
    // Padrão confirmado (OAuth2 client_credentials, Bearer) — mantido
    // por completude do adapter de referência, mesmo sabendo que o
    // domínio não responde mais.
    try {
      const response = await fetch(`${this.config.baseUrl ?? 'https://auth.nuvemfiscal.com.br'}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret, scope: 'nfse' }),
      })
      if (!response.ok) return { ok: false, errorCode: `auth_${response.status}`, errorMessage: 'Provider recusou a autenticação.', retryable: response.status >= 500 }
      const body = await response.json() as { access_token?: string }
      if (!body.access_token) return { ok: false, errorCode: 'auth_invalid_response', errorMessage: 'Resposta de autenticação sem access_token.', retryable: false }
      return { ok: true, data: body.access_token }
    } catch {
      return { ok: false, errorCode: 'auth_transport_error', errorMessage: 'Não foi possível conectar ao provider.', retryable: true }
    }
  }

  async healthCheck(): Promise<FiscalProviderResult<{ configured: boolean }>> {
    if (!this.config.clientId || !this.config.clientSecret) return { ok: true, data: { configured: false } }
    const token = await this.fetchAccessToken()
    return token.ok ? { ok: true, data: { configured: true } } : { ok: false, errorCode: token.errorCode, errorMessage: token.errorMessage, retryable: token.retryable }
  }

  async registerOrganization(): Promise<FiscalProviderResult<{ providerCompanyId: string }>> { return NOT_VERIFIED }
  async updateOrganization(): Promise<FiscalProviderResult<void>> { return NOT_VERIFIED }

  async issueServiceInvoice(request: FiscalInvoiceRequest): Promise<FiscalProviderResult<FiscalDocumentStatusResult>> {
    const token = await this.fetchAccessToken()
    if (!token.ok) return token
    // Requisição real de emissão nunca foi confirmada contra a
    // documentação (endpoint/payload exatos) — retorna explícito em
    // vez de adivinhar. request.externalId/request.totalAmount
    // existem para quando um adapter real (mesma interface) precisar
    // deles.
    void request
    return NOT_VERIFIED
  }

  async getDocument(): Promise<FiscalProviderResult<FiscalDocumentStatusResult>> { return NOT_VERIFIED }
  async refreshDocumentStatus(): Promise<FiscalProviderResult<FiscalDocumentStatusResult>> { return NOT_VERIFIED }
  async cancelDocument(): Promise<FiscalProviderResult<void>> { return NOT_VERIFIED }
  async getPdf(): Promise<FiscalProviderResult<{ url: string }>> { return NOT_VERIFIED }
  async getXml(): Promise<FiscalProviderResult<{ url: string }>> { return NOT_VERIFIED }
}
