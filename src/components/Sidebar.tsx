import { MoreHorizontal } from 'lucide-react'
import { Page, navigation, pageFeature, pagePermission } from '../routing'
import { usePermissions } from '../lib/PermissionsContext'
import { useOrganization } from '../core/organizations/useOrganization'
import { Drawer } from './ui/Drawer'
import './Sidebar.css'

type Props = { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void }

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  operator: 'Operador',
  viewer: 'Visualizador',
}

function SidebarNav({ page, setPage, onNavigate }: { page: Page; setPage: (p: Page) => void; onNavigate?: () => void }) {
  const { loading, can, hasFeature } = usePermissions()
  const { currentOrganization } = useOrganization()
  const workspaceName = currentOrganization?.organizationName ?? 'Carregando…'
  const roleLabel = currentOrganization ? (ROLE_LABEL[currentOrganization.role] ?? currentOrganization.role) : ''
  const workspaceInitials = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'MO'
  // Esconder o item, não só desabilitar — mas nunca a única linha de
  // defesa (has_org_permission no backend continua negando de qualquer
  // forma). Enquanto carrega, nada extra aparece: melhor um menu quase
  // vazio por um instante (nunca PERMANENTE — loading sempre resolve para
  // false, com sucesso ou erro) do que mostrar e depois sumir itens.
  // can() já concede tudo automaticamente quando access_total=true, sem
  // depender do código específico estar no conjunto plano.
  const visible = loading ? [] : navigation.filter(({ label }) => pagePermission[label].some((code) => can(code)) && (pageFeature[label] === undefined || hasFeature(pageFeature[label]!)))
  return (
    <>
      <div className="brand"><img src="/mugo-logo.png" alt="Mugô One" /><div><strong>MUGÔ</strong><span>ONE</span></div></div>
      <nav>
        {visible.map(({ label, icon: Icon }) => {
          const displayLabel = label === 'Visão Geral' ? 'Visão 360' : label
          return (
          <button
            key={label}
            className={page === label ? 'active' : ''}
            aria-label={displayLabel}
            aria-current={page === label ? 'page' : undefined}
            onClick={() => { setPage(label); onNavigate?.() }}
          >
            <Icon size={19} /><span>{displayLabel}</span>{label === 'IA' && <i>IA</i>}
          </button>
        )})}
      </nav>
      <div className="sidebar-foot">
        <div className="workspace-mark">{workspaceInitials}</div>
        <div><strong>{workspaceName}</strong><span>{roleLabel}</span></div>
        <MoreHorizontal size={18} />
      </div>
    </>
  )
}

/**
 * Desktop/tablet: fixed <aside> (unchanged markup/CSS on desktop; collapses
 * to an icon rail on tablet via Sidebar.css). Mobile: the same nav content
 * rendered again inside the shared Drawer primitive, which adds focus-trap,
 * ESC-to-close and return-focus — the old scrim had none of that.
 */
export function Sidebar({ page, setPage, open, close }: Props) {
  return (
    <>
      <aside className="sidebar">
        <SidebarNav page={page} setPage={setPage} />
      </aside>
      <Drawer open={open} onClose={close} aria-label="Menu de navegação">
        <div className="sidebar sidebar--drawer" data-mobile-sidebar-content>
          <SidebarNav page={page} setPage={setPage} onNavigate={close} />
        </div>
      </Drawer>
    </>
  )
}
