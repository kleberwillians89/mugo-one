import { ReactNode, createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { listMyOrganizations, type OrganizationMembershipSummary } from './listMyOrganizations'
import { resolveCurrentOrganization, setCurrentOrganizationOverride, type ResolvedOrganization } from './resolveCurrentOrganization'

type OrganizationState = {
  organizations: OrganizationMembershipSummary[]
  currentOrganization: ResolvedOrganization | null
  loading: boolean
  error: string
}

export type OrganizationContextValue = OrganizationState & {
  /** Troca a organização atual (persistida) e recarrega o contexto. Base para um futuro seletor de organização. */
  switchOrganization: (organizationId: string) => Promise<void>
  reload: () => void
}

const initialState: OrganizationState = { organizations: [], currentOrganization: null, loading: true, error: '' }

// undefined (em vez de um valor default silencioso) é proposital: força
// useOrganization() a lançar um erro claro quando chamado fora de
// OrganizationProvider, em vez de devolver dados vazios sem avisar —
// mesmo padrão de useOrganization em feat/core-foundation.
export const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

/**
 * Fonte única de verdade de "qual organização está ativa agora".
 * Ainda não é consumida por nenhuma página nesta sprint (nenhum seletor
 * de organização foi construído) — o objetivo é ter o contexto pronto e
 * testado para o próximo sprint (multi-organização de verdade), sem
 * quebrar nada do que já funciona hoje via `authenticatedOrganization()`
 * em `src/lib/records.ts`, que já delega para o mesmo resolver.
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrganizationState>(initialState)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) {
        if (!cancelled) setState({ organizations: [], currentOrganization: null, loading: false, error: '' })
        return
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) setState({ organizations: [], currentOrganization: null, loading: false, error: '' })
        return
      }
      try {
        const [organizations, currentOrganization] = await Promise.all([
          listMyOrganizations(user.id),
          resolveCurrentOrganization(user.id),
        ])
        if (!cancelled) setState({ organizations, currentOrganization, loading: false, error: '' })
      } catch (reason) {
        if (!cancelled) {
          setState({
            organizations: [],
            currentOrganization: null,
            loading: false,
            error: reason instanceof Error ? reason.message : 'Não foi possível carregar suas organizações.',
          })
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tick])

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!supabase) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    setCurrentOrganizationOverride(user.id, organizationId)
    setTick((n) => n + 1)
  }, [])

  const value = useMemo<OrganizationContextValue>(
    () => ({ ...state, switchOrganization, reload: () => setTick((n) => n + 1) }),
    [state, switchOrganization],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}
