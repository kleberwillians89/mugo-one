export type RecoveryVerificationResult = 'verified' | 'invalid' | 'ignored'

type RecoveryAuth = {
  verifyOtp: (params: { token_hash: string; type: 'recovery' }) => Promise<{
    data: { session: unknown | null }
    error: unknown
  }>
}

export function createRecoveryConfirmation(auth: RecoveryAuth, tokenHash: string) {
  let attempted = false

  return async (): Promise<RecoveryVerificationResult> => {
    if (attempted || !tokenHash) return 'ignored'
    attempted = true

    const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    return error || !data.session ? 'invalid' : 'verified'
  }
}
