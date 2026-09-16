import { useContext } from 'react'
import { OrganizationContext } from './OrganizationProvider'

export function useOrganization() {
  const context = useContext(OrganizationContext)

  if (!context) {
    throw new Error(
      'useOrganization deve ser usado dentro de OrganizationProvider',
    )
  }

  return context
}