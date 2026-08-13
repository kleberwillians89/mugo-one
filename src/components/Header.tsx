import { Bell, CircleHelp, Menu } from 'lucide-react'
import { Page } from '../routing'
import { IconButton } from './ui/IconButton'
import './Header.css'

type Props = { page: Page; menu: () => void }

export function Header({ page, menu }: Props) {
  return (
    <header>
      <IconButton className="header-menu-btn" icon={Menu} aria-label="Abrir menu" onClick={menu} />
      <div><p>CRM E INTELIGÊNCIA COMERCIAL</p><h1>{page}</h1></div>
      <div className="header-actions">
        <IconButton icon={CircleHelp} aria-label="Ajuda" />
        <IconButton icon={Bell} aria-label="Notificações" badge className="header-notification" />
        <span className="avatar" aria-hidden="true">KP</span>
      </div>
    </header>
  )
}
