import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrganizationContext, type OrganizationContextValue } from './OrganizationProvider'
import { useOrganization } from './useOrganization'

// renderToStaticMarkup roda em Node puro (sem jsdom, que este projeto não
// tem instalado) — suficiente para exercitar o hook através de um render
// real do React, sem precisar de DOM.
function Probe() {
  const organization = useOrganization()
  return createElement('span', null, organization.loading ? 'loading' : 'ready')
}

describe('useOrganization', () => {
  it('lança um erro claro quando usado fora de OrganizationProvider, em vez de devolver dados vazios silenciosamente', () => {
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(
      'useOrganization deve ser usado dentro de OrganizationProvider',
    )
  })

  it('funciona normalmente quando o contexto está presente', () => {
    const value: OrganizationContextValue = {
      organizations: [],
      currentOrganization: null,
      loading: false,
      error: '',
      switchOrganization: async () => {},
      reload: () => {},
    }
    const markup = renderToStaticMarkup(createElement(OrganizationContext.Provider, { value }, createElement(Probe)))
    expect(markup).toContain('ready')
  })
})
