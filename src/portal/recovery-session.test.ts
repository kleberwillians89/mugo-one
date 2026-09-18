import { describe, expect, it, vi } from 'vitest'
import { hasValidRecoverySession } from './recovery-session'

describe('Portal do Cliente recovery session gate', () => {
  it('accepts an authenticated recovery session without identity finalization', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: 'recovery-session' } }, error: null })
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null })
    const customerIdentityFinalize = vi.fn()

    await expect(hasValidRecoverySession({ getSession, getUser })).resolves.toBe(true)
    expect(getSession).toHaveBeenCalledOnce()
    expect(getUser).toHaveBeenCalledOnce()
    expect(customerIdentityFinalize).not.toHaveBeenCalled()
  })

  it('rejects missing sessions without attempting to resolve a user', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    const getUser = vi.fn()
    await expect(hasValidRecoverySession({ getSession, getUser })).resolves.toBe(false)
    expect(getUser).not.toHaveBeenCalled()
  })
})
