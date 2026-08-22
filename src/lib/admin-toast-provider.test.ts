import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const authRoot = readFileSync(new URL('../Auth.tsx', import.meta.url), 'utf8')

describe('admin application providers', () => {
  it('renders the authenticated CRM inside ToastProvider', () => {
    expect(authRoot).toContain("import { ToastProvider } from './components/ui'")
    expect(authRoot).toContain(
      'return <PermissionsProvider><ToastProvider><App/></ToastProvider></PermissionsProvider>',
    )
  })
})
