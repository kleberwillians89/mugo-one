import { useContext } from 'react'
import { OrganizationContext } from './OrganizationProvider'

export function useOrganization() {
  return useContext(OrganizationContext)
}
