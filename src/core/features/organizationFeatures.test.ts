import { describe, expect, it } from 'vitest'
import { isFeatureEnabled, resolveEnabledFeatureCodes } from './organizationFeatures'

describe('resolveEnabledFeatureCodes — mesma regra do has_organization_feature (SQL), sem RPC', () => {
  it('módulo core fica habilitado sem nenhuma linha explícita em organization_features (organização nova)', () => {
    const enabled = resolveEnabledFeatureCodes([{ code: 'crm', is_core: true }, { code: 'inventory', is_core: false }], [])
    expect(isFeatureEnabled(enabled, 'crm')).toBe(true)
    expect(isFeatureEnabled(enabled, 'inventory')).toBe(false)
  })

  it('uma linha explícita sempre vence o default de is_core, nos dois sentidos', () => {
    const enabled = resolveEnabledFeatureCodes(
      [{ code: 'crm', is_core: true }, { code: 'inventory', is_core: false }],
      [{ feature_code: 'crm', enabled: false }, { feature_code: 'inventory', enabled: true }],
    )
    expect(isFeatureEnabled(enabled, 'crm')).toBe(false)
    expect(isFeatureEnabled(enabled, 'inventory')).toBe(true)
  })

  it('tasks/radar/waitlist não-core ficam ocultos por padrão para uma organização sem overrides', () => {
    const enabled = resolveEnabledFeatureCodes(
      [{ code: 'tasks', is_core: false }, { code: 'radar', is_core: false }, { code: 'waitlist', is_core: false }, { code: 'shipping', is_core: false }],
      [],
    )
    expect(enabled.size).toBe(0)
  })
})
