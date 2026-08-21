type RecoverySessionAuth = {
  getSession: () => Promise<{
    data: { session: unknown | null }
    error: unknown
  }>
  getUser: () => Promise<{
    data: { user: unknown | null }
    error: unknown
  }>
}

export async function hasValidRecoverySession(auth: RecoverySessionAuth): Promise<boolean> {
  const { data: sessionData, error: sessionError } = await auth.getSession()
  if (sessionError || !sessionData.session) return false

  const { data: userData, error: userError } = await auth.getUser()
  return !userError && Boolean(userData.user)
}
