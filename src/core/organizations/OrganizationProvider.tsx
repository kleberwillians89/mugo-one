import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../../shared/lib/supabase'
import { useAuth } from '../auth/useAuth'

export type Organization = {
  id: string
  name: string
  slug: string
  status: string
  logo_url: string | null
}

export type OrganizationMembership = {
  organization_id: string
  role: string
  status: string
  organization: Organization
}

type OrganizationContextValue = {
  organizations: OrganizationMembership[]
  currentOrganization: OrganizationMembership | null
  loading: boolean

  setCurrentOrganization: (
    organization: OrganizationMembership,
  ) => void

  refreshOrganizations: () => Promise<void>
}

export const OrganizationContext =
  createContext<OrganizationContextValue | undefined>(undefined)

type OrganizationProviderProps = {
  children: ReactNode
}

export function OrganizationProvider({
  children,
}: OrganizationProviderProps) {
  const { user } = useAuth()

  const [organizations, setOrganizations] = useState<
    OrganizationMembership[]
  >([])

  const [currentOrganization, setCurrentOrganizationState] =
    useState<OrganizationMembership | null>(null)

  const [loading, setLoading] = useState(true)

  const refreshOrganizations = useCallback(async () => {
    if (!user) {
      setOrganizations([])
      setCurrentOrganizationState(null)
      setLoading(false)
      return
    }

    setLoading(true)

    const { data, error } = await supabase
      .from('organization_members')
      .select(`
        organization_id,
        role,
        status,
        organization:organizations (
          id,
          name,
          slug,
          status,
          logo_url
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (error) {
      console.error(
        'Erro ao carregar organizações:',
        error.message,
      )

      setOrganizations([])
      setCurrentOrganizationState(null)
      setLoading(false)
      return
    }

    const memberships =
      (data ?? []) as unknown as OrganizationMembership[]

    setOrganizations(memberships)

    setCurrentOrganizationState((current) => {
      if (
        current &&
        memberships.some(
          (item) =>
            item.organization_id === current.organization_id,
        )
      ) {
        return current
      }

      return memberships[0] ?? null
    })

    setLoading(false)
  }, [user])

  useEffect(() => {
    void refreshOrganizations()
  }, [refreshOrganizations])

  const setCurrentOrganization = useCallback(
    (organization: OrganizationMembership) => {
      setCurrentOrganizationState(organization)
    },
    [],
  )

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      currentOrganization,
      loading,
      setCurrentOrganization,
      refreshOrganizations,
    }),
    [
      organizations,
      currentOrganization,
      loading,
      setCurrentOrganization,
      refreshOrganizations,
    ],
  )

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}