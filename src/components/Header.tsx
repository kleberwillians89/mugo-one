import { LogOut, Menu } from 'lucide-react'
import { IconButton } from './ui/IconButton'
import { supabase } from '../lib/supabase'
import './Header.css'

type Props = { menu: () => void }

/**
 * Signs out and returns to /login — same behavior the old floating
 * `.logout-fab` button had, just moved in-flow into the header so it can
 * never sit fixed on top of scrolling page content (it was overlapping the
 * dashboard's "DADOS REAIS" badge on mobile).
 */
const logout = async () => {
  await supabase?.auth.signOut()
  history.pushState({}, '', '/login')
  dispatchEvent(new PopStateEvent('popstate'))
}

export function Header({ menu }: Props) {
  return (
    <header className="app-header">
      <IconButton className="header-menu-btn" icon={Menu} aria-label="Abrir menu" onClick={menu} />
      <div className="header-brand-mobile" aria-hidden="true"><strong>MUGÔ</strong><span>ONE</span></div>
      <div className="header-actions">
        <button type="button" onClick={logout} className="header-logout"><LogOut size={16}/><span>Sair</span></button>
      </div>
    </header>
  )
}
