export const MFA_PROVIDER_NOT_CONFIGURED = 'MFA_PROVIDER_NOT_CONFIGURED'

export function recordMfaProviderUnavailable() {
  console.warn('[Minha RUAH security]', MFA_PROVIDER_NOT_CONFIGURED)
}
