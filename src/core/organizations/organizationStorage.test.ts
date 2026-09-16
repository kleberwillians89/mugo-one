import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearStoredOrganizationId, getStoredOrganizationId, setStoredOrganizationId } from './organizationStorage'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage
}

describe('organizationStorage', () => {
  beforeEach(() => {
    ;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage()
  })
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('retorna null quando não há preferência salva', () => {
    expect(getStoredOrganizationId('user-1')).toBeNull()
  })

  it('persiste e recupera a organização por usuário, sem vazar entre usuários', () => {
    setStoredOrganizationId('user-1', 'org-a')
    expect(getStoredOrganizationId('user-1')).toBe('org-a')
    expect(getStoredOrganizationId('user-2')).toBeNull()
  })

  it('remove a preferência salva', () => {
    setStoredOrganizationId('user-1', 'org-a')
    clearStoredOrganizationId('user-1')
    expect(getStoredOrganizationId('user-1')).toBeNull()
  })

  it('nunca lança quando localStorage está indisponível (ex: ambiente sem DOM)', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage
    expect(() => setStoredOrganizationId('user-1', 'org-a')).not.toThrow()
    expect(getStoredOrganizationId('user-1')).toBeNull()
    expect(() => clearStoredOrganizationId('user-1')).not.toThrow()
  })
})
