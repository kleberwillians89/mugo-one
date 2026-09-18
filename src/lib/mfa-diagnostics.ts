export const MFA_PROVIDER_NOT_CONFIGURED = 'MFA_PROVIDER_NOT_CONFIGURED'

export function recordMfaProviderUnavailable() {
  console.warn('[MFA security]', MFA_PROVIDER_NOT_CONFIGURED)
}
