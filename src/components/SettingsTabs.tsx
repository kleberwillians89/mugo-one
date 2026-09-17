import { useHasPermission } from '../lib/PermissionsContext'

function go(path: string) {
  history.pushState({}, '', path)
  dispatchEvent(new PopStateEvent('popstate'))
}

// Nav compartilhada das 3 abas de Configurações — extraída de
// TeamSettingsPage/ShippingSettingsPage (que tinham a mesma barra de 2
// abas duplicada em dois arquivos) para acomodar a 3ª aba sem
// triplicar a lógica de permissão condicional.
export function SettingsTabs({ active }: { active: 'frete' | 'equipe' | 'entradas-de-leads' | 'comunicacoes' }) {
  const canViewTeam = useHasPermission('team.view')
  const canManageTeam = useHasPermission('team.manage')
  const canTeam = canViewTeam || canManageTeam
  const canLeadIntake = useHasPermission('lead_intake.view')
  const canCommunications = useHasPermission('communications.manage')
  // Antes de existir a 3ª aba, a barra inteira ficava escondida para
  // quem só via "Frete" (só faz sentido navegar se houver 2+ destinos).
  if (!canTeam && !canLeadIntake && !canCommunications) return null
  return (
    <div className="team-tabs">
      <button className={active === 'frete' ? 'active' : undefined} onClick={() => go('/configuracoes')}>Frete</button>
      {canTeam && <button className={active === 'equipe' ? 'active' : undefined} onClick={() => go('/configuracoes/equipe')}>Equipe e acessos</button>}
      {canLeadIntake && <button className={active === 'entradas-de-leads' ? 'active' : undefined} onClick={() => go('/configuracoes/entradas-de-leads')}>Entradas de Leads</button>}
      {canCommunications && <button className={active === 'comunicacoes' ? 'active' : undefined} onClick={() => go('/configuracoes/comunicacoes')}>Comunicações</button>}
    </div>
  )
}
