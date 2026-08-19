import { ReactNode, useEffect, useMemo, useState } from 'react'
import { defaultPeriod, PeriodValue } from './lib/period'
import { Page, routes, pageFromPath, pagePermission } from './routing'
import { usePermissions } from './lib/PermissionsContext'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { AccessRestricted } from './pages/AccessRestricted'
import { ShipmentDetailsPage, ShippingSettingsPage } from './components/ShipmentOperations'
import { Dashboard } from './pages/Dashboard'
import { ClientsPage } from './pages/ClientsPage'
import { ClientDetailsPage } from './pages/ClientDetailsPage'
import { SalesPage } from './pages/SalesPage'
import { SaleDetailsPage } from './pages/SaleDetailsPage'
import { DeliveriesPage } from './pages/DeliveriesPage'
import { InventoryPage } from './pages/InventoryPage'
import { ReplenishmentPage } from './pages/ReplenishmentPage'
import { ReportsPage } from './pages/ReportsPage'
import { MarginReportPage } from './pages/MarginReportPage'
import { ImportPage } from './pages/ImportPage'
import { Intelligence } from './pages/Intelligence'
import { Insights } from './pages/Insights'
import { RadarPage } from './pages/RadarPage'
import { RadarSuppliersPage } from './pages/RadarSuppliersPage'
import { WaitlistPage } from './pages/WaitlistPage'
import { ClientRecoveryPage } from './pages/ClientRecoveryPage'
import { ControlTowerPage } from './pages/ControlTowerPage'
import { GenericPage } from './pages/GenericPage'
import { TeamSettingsPage } from './pages/TeamSettingsPage'

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath())
  const [routePath,setRoutePath]=useState(location.pathname)
  const [period,setPeriod]=useState<PeriodValue>(defaultPeriod())
  const [menuOpen, setMenuOpen] = useState(false)
  const { loading: permissionsLoading, permissions } = usePermissions()
  useEffect(()=>{const change=()=>{setPage(pageFromPath());setRoutePath(location.pathname)};addEventListener('popstate',change);return()=>removeEventListener('popstate',change)},[])
  const navigate=(next:Page)=>{history.pushState({},'',routes[next]);setRoutePath(location.pathname);setPage(next)}
  const content = useMemo<ReactNode>(() => {
    // Rota digitada direto sem permissão: "ACESSO RESTRITO", nunca 404
    // (briefing "ROTAS E MENU"). Configurações tem duas abas com
    // permissões distintas (Frete=settings.view, Equipe=team.view), então
    // é checada por aba, não pelo gate genérico da página.
    if (page === 'Configurações') {
      const wantsTeam = routePath === '/configuracoes/equipe'
      const required = wantsTeam ? 'team.view' : 'settings.view'
      if (!permissionsLoading && !permissions.has(required)) return <AccessRestricted/>
      return wantsTeam ? <TeamSettingsPage/> : <ShippingSettingsPage/>
    }
    if (!permissionsLoading && !pagePermission[page].some((code) => permissions.has(code))) return <AccessRestricted/>
    if (page === 'Visão Geral') return <Dashboard period={period} setPeriod={setPeriod}/>
    if (page === 'Torre de Controle') return <ControlTowerPage/>
    if (page === 'Clientes') { const clientId=routePath.match(/^\/clientes\/([0-9a-f-]{36})$/i)?.[1]; return clientId?<ClientDetailsPage clientId={clientId}/>:routePath==='/clientes/recuperacao'?<ClientRecoveryPage/>:<ClientsPage period={period} setPeriod={setPeriod}/> }
    if (page === 'Vendas') {const saleId=routePath.match(/^\/vendas\/([0-9a-f-]{36})$/i)?.[1];return saleId?<SaleDetailsPage saleId={saleId}/>:<SalesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Entregas') {const shipmentId=routePath.match(/^\/entregas\/([0-9a-f-]{36})$/i)?.[1];return shipmentId?<ShipmentDetailsPage shipmentId={shipmentId}/>:<DeliveriesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Estoque') return routePath === '/estoque/reposicao' ? <ReplenishmentPage/> : <InventoryPage period={period} setPeriod={setPeriod}/>
    if (page === 'Relatórios') return routePath === '/relatorios/margem' ? <MarginReportPage period={period} setPeriod={setPeriod}/> : <ReportsPage period={period} setPeriod={setPeriod}/>
    if (page === 'Importação') return <ImportPage/>
    if (page === 'IA') return <Intelligence period={period} setPeriod={setPeriod}/>
    if (page === 'Insights') return <Insights period={period}/>
    if (page === 'Radar') return routePath === '/radar/fornecedores' ? <RadarSuppliersPage/> : <RadarPage initialQuery={new URLSearchParams(location.search).get('q')??undefined} initialPerfumeId={new URLSearchParams(location.search).get('perfume')??undefined}/>
    if (page === 'Interessados') return <WaitlistPage/>
    return <GenericPage page={page}/>
  }, [page,period,routePath,permissionsLoading,permissions])
  return <div className="app-shell"><Sidebar page={page} setPage={navigate} open={menuOpen} close={()=>setMenuOpen(false)}/><main><Header page={page} menu={()=>setMenuOpen(true)}/>{content}<footer className="internal-mugo-signature"><img src="/mugo-logo.png" alt="Mugô"/><span>RUAH Intelligence — desenvolvido pela Mugô</span></footer></main></div>
}
