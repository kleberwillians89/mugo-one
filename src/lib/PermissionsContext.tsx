import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { authenticatedOrganization } from './records'
import { fetchMyPermissions } from './permissions'

type PermissionsState = { loading: boolean; permissions: Set<string>; organizationId: string | null; reload: () => void }

const PermissionsCtx = createContext<PermissionsState>({ loading: true, permissions: new Set(), organizationId: null, reload: () => {} })

/**
 * Fonte única de verdade da UI para "o que este usuário pode ver/fazer" —
 * carregada uma vez por sessão via my_permission_summary (RPC, decide no
 * backend). Nunca usada para AUTORIZAR uma escrita — só para
 * esconder/mostrar/desabilitar (briefing: "Não usar somente
 * localStorage/context React" — a autoridade real é sempre a RPC/RLS,
 * isto aqui é só UX).
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<PermissionsState, 'reload'>>({ loading: true, permissions: new Set(), organizationId: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    authenticatedOrganization()
      .then(({ organizationId }) => fetchMyPermissions(organizationId).then((permissions) => {
        if (!cancelled) setState({ loading: false, permissions, organizationId })
      }))
      .catch(() => { if (!cancelled) setState({ loading: false, permissions: new Set(), organizationId: null }) })
    return () => { cancelled = true }
  }, [tick])
  return <PermissionsCtx.Provider value={{ ...state, reload: () => setTick((n) => n + 1) }}>{children}</PermissionsCtx.Provider>
}

export function usePermissions() {
  return useContext(PermissionsCtx)
}

/** true só depois que o carregamento inicial termina E o código está no conjunto concedido — nunca "true por padrão" enquanto carrega. */
export function useHasPermission(code: string) {
  const { permissions } = useContext(PermissionsCtx)
  return permissions.has(code)
}
