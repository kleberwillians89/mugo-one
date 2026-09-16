const STORAGE_PREFIX = 'mugo:organization:'

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`
}

/**
 * globalThis.localStorage (em vez do identificador global `localStorage`)
 * nunca lança ReferenceError — em ambiente sem storage (testes vitest sem
 * jsdom, modo privado, etc.) o acesso só resulta em `undefined`.
 */
function getStorage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  } catch {
    return null
  }
}

export function getStoredOrganizationId(userId: string): string | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return storage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

export function setStoredOrganizationId(userId: string, organizationId: string): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(storageKey(userId), organizationId)
  } catch {
    /* localStorage indisponível (modo privado, quota, etc.) — falha silenciosa, não é crítico. */
  }
}

export function clearStoredOrganizationId(userId: string): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(storageKey(userId))
  } catch {
    /* idem */
  }
}
