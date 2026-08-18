import { ReactNode, useEffect, useMemo, useState } from 'react'
import { defaultPeriod, PeriodValue } from './lib/period'
import { Page, routes, pageFromPath } from './routing'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
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
import { GenericPage } from './pages/GenericPage'

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath())
  const [routePath,setRoutePath]=useState(location.pathname)
  const [period,setPeriod]=useState<PeriodValue>(defaultPeriod())
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(()=>{const change=()=>{setPage(pageFromPath());setRoutePath(location.pathname)};addEventListener('popstate',change);return()=>removeEventListener('popstate',change)},[])
  const navigate=(next:Page)=>{history.pushState({},'',routes[next]);setRoutePath(location.pathname);setPage(next)}
  const content = useMemo<ReactNode>(() => {
    if (page === 'Visão Geral') return <Dashboard period={period} setPeriod={setPeriod}/>
    if (page === 'Clientes') { const clientId=routePath.match(/^\/clientes\/([0-9a-f-]{36})$/i)?.[1]; return clientId?<ClientDetailsPage clientId={clientId}/>:routePath==='/clientes/recuperacao'?<ClientRecoveryPage/>:<ClientsPage period={period} setPeriod={setPeriod}/> }
    if (page === 'Vendas') {const saleId=routePath.match(/^\/vendas\/([0-9a-f-]{36})$/i)?.[1];return saleId?<SaleDetailsPage saleId={saleId}/>:<SalesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Entregas') {const shipmentId=routePath.match(/^\/entregas\/([0-9a-f-]{36})$/i)?.[1];return shipmentId?<ShipmentDetailsPage shipmentId={shipmentId}/>:<DeliveriesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Estoque') return routePath === '/estoque/reposicao' ? <ReplenishmentPage/> : <InventoryPage period={period} setPeriod={setPeriod}/>
    if (page === 'Relatórios') return routePath === '/relatorios/margem' ? <MarginReportPage period={period} setPeriod={setPeriod}/> : <ReportsPage period={period} setPeriod={setPeriod}/>
    if (page === 'Importação') return <ImportPage/>
    if (page === 'IA') return <Intelligence period={period} setPeriod={setPeriod}/>
    if (page === 'Insights') return <Insights period={period}/>
    if (page === 'Radar') return routePath === '/radar/fornecedores' ? <RadarSuppliersPage/> : <RadarPage initialQuery={new URLSearchParams(location.search).get('q')??undefined}/>
    if (page === 'Interessados') return <WaitlistPage/>
    if(page==='Configurações')return <ShippingSettingsPage/>
    return <GenericPage page={page}/>
  }, [page,period,routePath])
  return <div className="app-shell"><Sidebar page={page} setPage={navigate} open={menuOpen} close={()=>setMenuOpen(false)}/><main><Header page={page} menu={()=>setMenuOpen(true)}/>{content}<footer className="internal-mugo-signature"><img src="/mugo-logo.png" alt="Mugô"/><span>RUAH Intelligence — desenvolvido pela Mugô</span></footer></main></div>
}
