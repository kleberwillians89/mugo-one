import { MoreHorizontal } from 'lucide-react'
import { Page, navigation, pagePermission } from '../routing'
import { usePermissions } from '../lib/PermissionsContext'
import { Drawer } from './ui/Drawer'
import './Sidebar.css'

type Props = { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void }

function SidebarNav({ page, setPage, onNavigate }: { page: Page; setPage: (p: Page) => void; onNavigate?: () => void }) {
  const { loading, can } = usePermissions()
  // Esconder o item, não só desabilitar — mas nunca a única linha de
  // defesa (has_org_permission no backend continua negando de qualquer
  // forma). Enquanto carrega, nada extra aparece: melhor um menu quase
  // vazio por um instante (nunca PERMANENTE — loading sempre resolve para
  // false, com sucesso ou erro) do que mostrar e depois sumir itens.
  // can() já concede tudo automaticamente quando access_total=true, sem
  // depender do código específico estar no conjunto plano.
  const visible = loading ? [] : navigation.filter(({ label }) => pagePermission[label].some((code) => can(code)))
  return (
    <>
      <div className="brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><div><strong>RUAH</strong><span>INTELLIGENCE</span></div></div>
      <nav>
        {visible.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={page === label ? 'active' : ''}
            aria-label={label}
            aria-current={page === label ? 'page' : undefined}
            onClick={() => { setPage(label); onNavigate?.() }}
          >
            <Icon size={19} /><span>{label}</span>{label === 'IA' && <i>IA</i>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="workspace-mark">RP</div>
        <div><strong>RUAH Parfums</strong><span>Administrador</span></div>
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
        <div className="sidebar sidebar--drawer">
          <SidebarNav page={page} setPage={setPage} onNavigate={close} />
        </div>
      </Drawer>
    </>
  )
}
