import {
  Boxes, FileText, Home, Import, Lightbulb, Radar, Settings, ShoppingBag, Sparkles, Truck, UsersRound,
} from 'lucide-react'

export type Page = 'Visão Geral'|'Clientes'|'Vendas'|'Entregas'|'Estoque'|'Relatórios'|'Importação'|'IA'|'Insights'|'Radar'|'Configurações'

export const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Clientes', icon: UsersRound },
  { label: 'Vendas', icon: ShoppingBag }, { label: 'Entregas', icon: Truck },
  { label: 'Estoque', icon: Boxes },
  { label: 'Relatórios', icon: FileText }, { label: 'Importação', icon: Import },
  { label: 'IA', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Radar', icon: Radar },
  { label: 'Configurações', icon: Settings },
]

export const routes:Record<Page,string>={'Visão Geral':'/','Clientes':'/clientes','Vendas':'/vendas','Entregas':'/entregas','Estoque':'/estoque','Relatórios':'/relatorios','Importação':'/importacao','IA':'/ia','Insights':'/insights','Radar':'/radar','Configurações':'/configuracoes'}

export const pageFromPath=()=>location.pathname.startsWith('/clientes/')?'Clientes':location.pathname.startsWith('/vendas/')?'Vendas':location.pathname.startsWith('/entregas/')?'Entregas':location.pathname.startsWith('/radar')?'Radar':Object.entries(routes).find(([,path])=>path===location.pathname)?.[0] as Page||'Visão Geral'
