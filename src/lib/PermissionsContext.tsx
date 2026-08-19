import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { authenticatedOrganization } from './records'
import { MembershipFlags, computeCan, fetchMyMembershipFlags, fetchMyPermissions } from './permissions'

type PermissionsState = {
  loading: boolean
  error: string
  permissions: Set<string>
  flags: MembershipFlags | null
  organizationId: string | null
}

const initialState: PermissionsState = { loading: true, error: '', permissions: new Set(), flags: null, organizationId: null }

const PermissionsCtx = createContext<PermissionsState & { can: (code: string) => boolean; reload: () => void }>({
  ...initialState, can: () => false, reload: () => {},
})

/**
 * Fonte única de verdade da UI para "o que este usuário pode ver/fazer" —
 * carregada uma vez por sessão. Nunca usada para AUTORIZAR uma escrita —
 * só para esconder/mostrar/desabilitar (a autoridade real é sempre a
 * RPC/RLS via has_org_permission).
 *
 * `error` é um estado PRÓPRIO, nunca colapsado dentro de `permissions`
 * vazio — antes disto, qualquer falha (rede, timing) virava um Set vazio
 * indistinguível de "negado para tudo", e o menu sumia inteiro sem
 * nenhum jeito de perceber que era uma falha, não uma decisão de acesso.
 * "loading" e "erro" são estados diferentes de "negado": enquanto carrega
 * ou se a busca falhou, os consumidores não devem tratar isso como
 * decisão final — só quando loading=false e error='' o resultado é
 * confiável.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PermissionsState>(initialState)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    authenticatedOrganization()
      .then(({ organizationId }) => Promise.all([fetchMyPermissions(organizationId), fetchMyMembershipFlags(organizationId)])
        .then(([permissions, flags]) => {
          if (!cancelled) setState({ loading: false, error: '', permissions, flags, organizationId })
        }))
      .catch((reason) => {
        if (!cancelled) setState({ loading: false, error: reason instanceof Error ? reason.message : 'Não foi possível carregar suas permissões.', permissions: new Set(), flags: null, organizationId: null })
      })
    return () => { cancelled = true }
  }, [tick])
  const can = (code: string) => computeCan(code, state.flags, state.permissions)
  return <PermissionsCtx.Provider value={{ ...state, can, reload: () => setTick((n) => n + 1) }}>{children}</PermissionsCtx.Provider>
}

export function usePermissions() {
  return useContext(PermissionsCtx)
}

/** access_total sempre vence, mesmo que o código específico não esteja no conjunto plano (ver computeCan). */
export function useHasPermission(code: string) {
  return useContext(PermissionsCtx).can(code)
}
