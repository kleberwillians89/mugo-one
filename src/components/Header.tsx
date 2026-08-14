import { Bell, CircleHelp, LogOut, Menu } from 'lucide-react'
import { Page } from '../routing'
import { IconButton } from './ui/IconButton'
import { supabase } from '../lib/supabase'
import './Header.css'

type Props = { page: Page; menu: () => void }

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

export function Header({ page, menu }: Props) {
  return (
    <header>
      <IconButton className="header-menu-btn" icon={Menu} aria-label="Abrir menu" onClick={menu} />
      <div><p>CRM E INTELIGÊNCIA COMERCIAL</p><h1>{page}</h1></div>
      <div className="header-actions">
        <IconButton icon={CircleHelp} aria-label="Ajuda" />
        <IconButton icon={Bell} aria-label="Notificações" badge className="header-notification" />
        <span className="avatar" aria-hidden="true">KP</span>
        <IconButton icon={LogOut} aria-label="Sair" onClick={logout} className="header-logout"/>
      </div>
    </header>
  )
}
