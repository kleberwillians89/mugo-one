import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./listMyOrganizations', () => ({
  listMyOrganizations: vi.fn(),
}))

import { listMyOrganizations } from './listMyOrganizations'
import { resolveCurrentOrganization, setCurrentOrganizationOverride } from './resolveCurrentOrganization'

const mockedList = vi.mocked(listMyOrganizations)

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

describe('resolveCurrentOrganization', () => {
  beforeEach(() => {
    ;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage()
    mockedList.mockReset()
  })
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
    vi.restoreAllMocks()
  })

  it('lança quando o usuário não pertence a nenhuma organização — nunca inventa um tenant', async () => {
    mockedList.mockResolvedValue([])
    await expect(resolveCurrentOrganization('user-1')).rejects.toThrow('Usuário sem organização vinculada.')
  })

  it('seleciona automaticamente e persiste quando há apenas uma organização (escolha inequívoca)', async () => {
    mockedList.mockResolvedValue([{ organizationId: 'org-a', role: 'admin', organizationName: 'Empresa A' }])
    const result = await resolveCurrentOrganization('user-1')
    expect(result.organizationId).toBe('org-a')
    expect(result.resolvedBy).toBe('single')
  })

  it('respeita a preferência salva quando ela ainda é uma organização válida do usuário', async () => {
    mockedList.mockResolvedValue([
      { organizationId: 'org-a', role: 'admin', organizationName: 'Empresa A' },
      { organizationId: 'org-b', role: 'viewer', organizationName: 'Empresa B' },
    ])
    setCurrentOrganizationOverride('user-1', 'org-b')
    const result = await resolveCurrentOrganization('user-1')
    expect(result.organizationId).toBe('org-b')
    expect(result.resolvedBy).toBe('stored')
  })

  it('ignora preferência salva que não corresponde a nenhuma organização atual do usuário', async () => {
    mockedList.mockResolvedValue([{ organizationId: 'org-a', role: 'admin', organizationName: 'Empresa A' }])
    setCurrentOrganizationOverride('user-1', 'org-inexistente')
    const result = await resolveCurrentOrganization('user-1')
    expect(result.organizationId).toBe('org-a')
    expect(result.resolvedBy).toBe('single')
  })

  it('usa a primeira organização (created_at asc) como default determinístico quando é ambíguo, e avisa via console.warn', async () => {
    mockedList.mockResolvedValue([
      { organizationId: 'org-a', role: 'admin', organizationName: 'Empresa A' },
      { organizationId: 'org-b', role: 'viewer', organizationName: 'Empresa B' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await resolveCurrentOrganization('user-1')
    expect(result.organizationId).toBe('org-a')
    expect(result.resolvedBy).toBe('first-fallback')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('a segunda resolução do mesmo usuário ambíguo já usa a preferência persistida pela primeira (não avisa de novo)', async () => {
    mockedList.mockResolvedValue([
      { organizationId: 'org-a', role: 'admin', organizationName: 'Empresa A' },
      { organizationId: 'org-b', role: 'viewer', organizationName: 'Empresa B' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await resolveCurrentOrganization('user-1')
    warn.mockClear()
    const second = await resolveCurrentOrganization('user-1')
    expect(second.resolvedBy).toBe('stored')
    expect(warn).not.toHaveBeenCalled()
  })
})
