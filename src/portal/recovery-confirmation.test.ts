import { describe, expect, it, vi } from 'vitest'
import { createRecoveryConfirmation } from './recovery-confirmation'

describe('recovery confirmation anti-prefetch handoff', () => {
  it('does not consume the token on GET or reload and verifies exactly once after the click', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: { session: { access_token: 'session' } }, error: null })
    const auth = { verifyOtp }

    createRecoveryConfirmation(auth, 'official-token-hash')
    expect(verifyOtp).not.toHaveBeenCalled()

    const afterReload = createRecoveryConfirmation(auth, 'official-token-hash')
    expect(verifyOtp).not.toHaveBeenCalled()

    await expect(afterReload()).resolves.toBe('verified')
    await expect(afterReload()).resolves.toBe('ignored')
    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'official-token-hash', type: 'recovery' })
  })

  it('does not call verifyOtp without a token and normalizes invalid responses', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error('otp_expired') })
    await expect(createRecoveryConfirmation({ verifyOtp }, '')()).resolves.toBe('ignored')
    expect(verifyOtp).not.toHaveBeenCalled()
    await expect(createRecoveryConfirmation({ verifyOtp }, 'expired')()).resolves.toBe('invalid')
  })
})
