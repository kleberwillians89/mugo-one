import { ReactNode, useEffect, useMemo, useState } from 'react'
import { advanceBootPeriod, defaultPeriod, initialBootPeriodState, PeriodValue } from './lib/period'
import { Page, routes, pageFromPath, pageFeature, pagePermission } from './routing'
import { usePermissions } from './lib/PermissionsContext'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { AccessRestricted } from './pages/AccessRestricted'
import { ShipmentDetailsPage, ShippingSettingsPage } from './components/ShipmentOperations'
import { Dashboard } from './pages/Dashboard'
import { ClientsPage } from './pages/ClientsPage'
import { ClientDetailsPage } from './pages/ClientDetailsPage'
import { SalesPage } from './pages/SalesPage'
import { SpreadsheetPage } from './pages/SpreadsheetPage'
import { CobrancasPage } from './pages/CobrancasPage'
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
import { CustomerIdentityReviewsPage } from './pages/CustomerIdentityReviewsPage'

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath())
  const [routePath,setRoutePath]=useState(location.pathname)
  const [bootPeriod,setBootPeriod]=useState(()=>initialBootPeriodState(defaultPeriod()))
  const [menuOpen, setMenuOpen] = useState(false)
  const { loading: permissionsLoading, can, hasFeature, operationalSalesStartDate } = usePermissions()
  useEffect(()=>{const change=()=>{setPage(pageFromPath());setRoutePath(location.pathname)};addEventListener('popstate',change);return()=>removeEventListener('popstate',change)},[])
  // Ajuste durante a renderização (não em useEffect) é o padrão recomendado
  // pelo próprio React para "sincronizar estado local quando um valor
  // externo chega" — https://react.dev/learn/you-might-not-need-an-effect.
  // advanceBootPeriod (testado em period.test.ts) garante que "ready" só
  // vira true com o período já resolvido — ver o gate em `content` abaixo.
  const advancedBootPeriod=advanceBootPeriod(bootPeriod,permissionsLoading,operationalSalesStartDate)
  if(advancedBootPeriod!==bootPeriod)setBootPeriod(advancedBootPeriod)
  const period=bootPeriod.period,setPeriod=(next:PeriodValue)=>setBootPeriod(current=>({...current,period:next}))
  const navigate=(next:Page)=>{history.pushState({},'',routes[next]);setRoutePath(location.pathname);setPage(next)}
  const content = useMemo<ReactNode>(() => {
    // Enquanto bootPeriod não está "ready", NENHUMA página monta — nem
    // Dashboard/Vendas/Entregas, que buscam dados dependentes de período.
    // Sem este gate, elas montariam com o período provisório (todo o
    // histórico), disparariam a busca errada e buscariam de novo assim que
    // o período fosse corrigido — dois fetches, um deles inútil e
    // potencialmente pesado (milhares de linhas). advanceBootPeriod só marca
    // ready=true já com o período definitivo resolvido (ver period.ts) — a
    // primeira montagem de qualquer página já acontece com o valor certo.
    if (!bootPeriod.ready) return <div className="page"><div className="empty card"><h3>Carregando…</h3></div></div>
    // Rota digitada direto sem permissão: "ACESSO RESTRITO", nunca 404
    // (briefing "ROTAS E MENU"). Configurações tem duas abas com
    // permissões distintas (Frete=settings.view, Equipe=team.view), então
    // é checada por aba, não pelo gate genérico da página. can() já
    // concede tudo quando access_total=true, mesmo que o código
    // específico não esteja no conjunto plano vindo do backend.
    if (page === 'Configurações') {
      const wantsTeam = routePath === '/configuracoes/equipe'
      // Equipe: team.view OU team.manage (quem administra a equipe
      // precisa conseguir vê-la, mesmo numa combinação incomum onde só
      // team.manage foi concedido). Frete: só settings.view mesmo.
      const allowed = wantsTeam ? can('team.view') || can('team.manage') : can('settings.view')
      if (!permissionsLoading && !allowed) return <AccessRestricted/>
      return wantsTeam ? <TeamSettingsPage/> : <ShippingSettingsPage/>
    }
    const requiredFeature = pageFeature[page]
    if (!permissionsLoading && (!pagePermission[page].some((code) => can(code)) || (requiredFeature !== undefined && !hasFeature(requiredFeature)))) return <AccessRestricted/>
    if (page === 'Visão Geral') return <Dashboard/>
    if (page === 'Torre de Controle') return <ControlTowerPage/>
    if (page === 'Clientes') { const clientId=routePath.match(/^\/clientes\/([0-9a-f-]{36})$/i)?.[1]; return clientId?<ClientDetailsPage clientId={clientId}/>:routePath==='/clientes/recuperacao'?<ClientRecoveryPage/>:routePath==='/clientes/acessos-minha-ruah'?<CustomerIdentityReviewsPage/>:<ClientsPage period={period} setPeriod={setPeriod}/> }
    if (page === 'Vendas') {const saleId=routePath.match(/^\/vendas\/([0-9a-f-]{36})$/i)?.[1];return saleId?<SaleDetailsPage saleId={saleId}/>:<SalesPage period={period} setPeriod={setPeriod}/>}
    if (page === 'Planilha') return <SpreadsheetPage/>
    if (page === 'Cobranças') return <CobrancasPage/>
    if (page === 'Entregas') {const shipmentId=routePath.match(/^\/entregas\/([0-9a-f-]{36})$/i)?.[1];return shipmentId?<ShipmentDetailsPage shipmentId={shipmentId}/>:<DeliveriesPage period={period} setPeriod={setPeriod}/>}
    // '/estoque/fracionamento' (split/fracionamento de frasco, PreparationPage)
    // foi isolado como legado — não faz parte do Core do Mugô One (ver
    // src/legacy/operations/). Uma URL antiga para essa rota cai no estoque
    // genérico normal, não em 404.
    if (page === 'Estoque') return routePath === '/estoque/reposicao' ? <ReplenishmentPage/> : <InventoryPage period={period} setPeriod={setPeriod}/>
    if (page === 'Relatórios') return routePath === '/relatorios/margem' ? <MarginReportPage period={period} setPeriod={setPeriod}/> : <ReportsPage period={period} setPeriod={setPeriod}/>
    if (page === 'Importação') return <ImportPage/>
    if (page === 'IA') return <Intelligence period={period} setPeriod={setPeriod}/>
    if (page === 'Insights') return <Insights period={period}/>
    if (page === 'Radar') return routePath === '/radar/fornecedores' ? <RadarSuppliersPage/> : <RadarPage initialQuery={new URLSearchParams(location.search).get('q')??undefined} initialPerfumeId={new URLSearchParams(location.search).get('perfume')??undefined}/>
    if (page === 'Interessados') return <WaitlistPage/>
    return <GenericPage page={page}/>
  }, [page,period,routePath,permissionsLoading,can,hasFeature,bootPeriod.ready])
  return <div className="app-shell"><Sidebar page={page} setPage={navigate} open={menuOpen} close={()=>setMenuOpen(false)}/><main><Header menu={()=>setMenuOpen(true)}/>{content}<footer className="internal-mugo-signature"><img src="/mugo-logo.png" alt="Mugô"/><span>Mugô One — desenvolvido pela Mugô</span></footer></main></div>
}
