import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const authRoot = readFileSync(new URL('../Auth.tsx', import.meta.url), 'utf8')

describe('admin application providers', () => {
  it('renders the authenticated CRM inside ToastProvider, inside OrganizationProvider', () => {
    expect(authRoot).toContain("import { ToastProvider } from './components/ui'")
    expect(authRoot).toContain("import { OrganizationProvider } from './core/organizations/OrganizationProvider'")
    expect(authRoot).toContain(
      'return <OrganizationProvider><PermissionsProvider><ToastProvider><App/></ToastProvider></PermissionsProvider></OrganizationProvider>',
    )
  })
})
