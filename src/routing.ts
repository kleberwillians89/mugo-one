import {
  Boxes, Compass, FileText, Home, Import, Lightbulb, Radar, Settings, ShoppingBag, Sparkles, Truck, UserRound, UsersRound,
} from 'lucide-react'

export type Page = 'Visão Geral'|'Torre de Controle'|'Clientes'|'Vendas'|'Entregas'|'Estoque'|'Relatórios'|'Importação'|'IA'|'Insights'|'Radar'|'Interessados'|'Configurações'

export const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Torre de Controle', icon: Compass },
  { label: 'Clientes', icon: UsersRound },
  { label: 'Vendas', icon: ShoppingBag }, { label: 'Entregas', icon: Truck },
  { label: 'Estoque', icon: Boxes },
  { label: 'Relatórios', icon: FileText }, { label: 'Importação', icon: Import },
  { label: 'IA', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Radar', icon: Radar },
  { label: 'Interessados', icon: UserRound },
  { label: 'Configurações', icon: Settings },
]

export const routes:Record<Page,string>={'Visão Geral':'/','Torre de Controle':'/torre-de-controle','Clientes':'/clientes','Vendas':'/vendas','Entregas':'/entregas','Estoque':'/estoque','Relatórios':'/relatorios','Importação':'/importacao','IA':'/ia','Insights':'/insights','Radar':'/radar','Interessados':'/interessados','Configurações':'/configuracoes'}

export const pageFromPath=()=>location.pathname.startsWith('/clientes/')?'Clientes':location.pathname.startsWith('/vendas/')?'Vendas':location.pathname.startsWith('/entregas/')?'Entregas':location.pathname.startsWith('/radar')?'Radar':location.pathname.startsWith('/estoque')?'Estoque':location.pathname.startsWith('/relatorios')?'Relatórios':Object.entries(routes).find(([,path])=>path===location.pathname)?.[0] as Page||'Visão Geral'
