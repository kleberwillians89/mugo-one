import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { authenticatedOrganization, fetchOperationalSalesStartDate } from './records'
import { MembershipFlags, computeCan, fetchMyMembershipFlags, fetchMyPermissions } from './permissions'
import { fetchEnabledFeatureCodes, isFeatureEnabled } from '../core/features/organizationFeatures'
import { FeatureCode } from '../core/features/featureCatalog'

type PermissionsState = {
  loading: boolean
  error: string
  permissions: Set<string>
  flags: MembershipFlags | null
  organizationId: string | null
  operationalSalesStartDate: string | null
  features: Set<string>
}

const initialState: PermissionsState = { loading: true, error: '', permissions: new Set(), flags: null, organizationId: null, operationalSalesStartDate: null, features: new Set() }

const PermissionsCtx = createContext<PermissionsState & { can: (code: string) => boolean; hasFeature: (code: FeatureCode) => boolean; reload: () => void }>({
  ...initialState, can: () => false, hasFeature: () => false, reload: () => {},
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
      .then(({ organizationId }) => Promise.all([fetchMyPermissions(organizationId), fetchMyMembershipFlags(organizationId), fetchOperationalSalesStartDate(organizationId), fetchEnabledFeatureCodes(organizationId)])
        .then(([permissions, flags, operationalSalesStartDate, features]) => {
          if (!cancelled) setState({ loading: false, error: '', permissions, flags, organizationId, operationalSalesStartDate, features })
        }))
      .catch((reason) => {
        if (!cancelled) setState({ loading: false, error: reason instanceof Error ? reason.message : 'Não foi possível carregar suas permissões.', permissions: new Set(), flags: null, organizationId: null, operationalSalesStartDate: null, features: new Set() })
      })
    return () => { cancelled = true }
  }, [tick])
  const can = (code: string) => computeCan(code, state.flags, state.permissions)
  const hasFeature = (code: FeatureCode) => isFeatureEnabled(state.features, code)
  return <PermissionsCtx.Provider value={{ ...state, can, hasFeature, reload: () => setTick((n) => n + 1) }}>{children}</PermissionsCtx.Provider>
}

export function usePermissions() {
  return useContext(PermissionsCtx)
}

/** access_total sempre vence, mesmo que o código específico não esteja no conjunto plano (ver computeCan). */
export function useHasPermission(code: string) {
  return useContext(PermissionsCtx).can(code)
}

/** Módulo habilitado para a organização atual (features/organization_features) — ver fetchEnabledFeatureCodes. */
export function useHasFeature(code: FeatureCode) {
  return useContext(PermissionsCtx).hasFeature(code)
}

/** Data de início configurada; o domínio aplica o fallback seguro central quando vier null. */
export function useOperationalSalesStartDate() {
  return useContext(PermissionsCtx).operationalSalesStartDate
}
