import {
  Boxes, CircleDollarSign, Compass, FileSpreadsheet, FileText, Home, Import, Lightbulb, Radar, Settings, ShoppingBag, Sparkles, Truck, UserRound, UsersRound,
} from 'lucide-react'
import { FeatureCode } from './core/features/featureCatalog'

// 'Falta Splitar' (fila de fracionamento/split de frasco) foi isolada como
// legado — não é um conceito do Core do Mugô One. O código ainda existe em
// src/legacy/operations/pages/FaltaSplitarPage.tsx, mas não faz parte da
// navegação/roteamento ativos (ver src/legacy/operations/README.md).
export type Page = 'Visão Geral'|'Torre de Controle'|'Clientes'|'Vendas'|'Davi Excel'|'Cobranças'|'Entregas'|'Estoque'|'Relatórios'|'Importação'|'IA'|'Insights'|'Radar'|'Interessados'|'Configurações'

export const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Torre de Controle', icon: Compass },
  { label: 'Davi Excel', icon: FileSpreadsheet }, { label: 'Vendas', icon: ShoppingBag },
  { label: 'Cobranças', icon: CircleDollarSign },
  { label: 'Entregas', icon: Truck }, { label: 'Estoque', icon: Boxes },
  { label: 'Clientes', icon: UsersRound },
  { label: 'Relatórios', icon: FileText }, { label: 'Importação', icon: Import },
  { label: 'IA', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Radar', icon: Radar },
  { label: 'Interessados', icon: UserRound },
  { label: 'Configurações', icon: Settings },
]

export const routes:Record<Page,string>={'Visão Geral':'/','Torre de Controle':'/torre-de-controle','Clientes':'/clientes','Vendas':'/vendas','Davi Excel':'/davi-excel','Cobranças':'/cobrancas','Entregas':'/entregas','Estoque':'/estoque','Relatórios':'/relatorios','Importação':'/importacao','IA':'/ia','Insights':'/insights','Radar':'/radar','Interessados':'/interessados','Configurações':'/configuracoes'}

// Permissão mínima para VER cada módulo no menu/rota (briefing "ROTAS E
// MENU"). Configurações tem três códigos alternativos porque a página tem
// duas abas (Frete/Equipe) cada uma com sua própria permissão, e
// team.manage entra também: um usuário personalizado com team.manage=true
// mas team.view=false (combinação incomum, mas possível via "Personalizar
// Permissões") ainda precisa enxergar o item de menu para conseguir
// administrar a equipe — cada aba decide sozinha se mostra seu próprio
// conteúdo ou "Acesso restrito" (ver TeamSettingsPage/ShippingSettingsPage).
// A checagem em si passa por PermissionsContext.can(), que já concede
// tudo automaticamente quando access_total=true — nenhum destes códigos
// precisa listar "access_total" explicitamente aqui.
export const pagePermission:Record<Page,string[]>={
  'Visão Geral':['dashboard.view'],'Torre de Controle':['tasks.sales','tasks.shipping','tasks.management'],
  'Clientes':['clients.view'],'Vendas':['sales.view'],'Entregas':['shipping.view'],
  'Davi Excel':['sales.view'],'Cobranças':['sales.view'],
  'Estoque':['inventory.view'],'Relatórios':['reports.view'],'Importação':['ai_import.view'],
  'IA':['ai_import.view'],'Insights':['reports.view'],'Radar':['radar.view'],
  'Interessados':['waitlist.view'],'Configurações':['settings.view','team.view','team.manage'],
}

// Módulos ainda estruturalmente verticais (ver
// docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md) — ocultos por padrão para
// organizações novas via organization_features/has_organization_feature
// (migration 202609200001). Uma página fora deste mapa nunca é escondida
// por feature flag, só por permissão (pagePermission acima). Permissão
// continua sendo checada sempre — isto só ADICIONA um segundo portão,
// nunca substitui o primeiro.
export const pageFeature:Partial<Record<Page,FeatureCode>>={
  'Torre de Controle':'tasks','Estoque':'inventory','Entregas':'shipping','Radar':'radar','Interessados':'waitlist',
}

// '/configuracoes/equipe' (aba Equipe, ver TeamSettingsPage) não é uma rota
// exata do mapa `routes` (que só tem '/configuracoes') — sem este prefixo,
// pageFromPath cairia no fallback 'Visão Geral' tanto ao recarregar a URL
// direto quanto ao clicar "Equipe e acessos" (que navega via
// pushState+popstate, reusando esta função), jogando o usuário de volta
// para o Dashboard mesmo com a rota certa na barra de endereço.
export const pageFromPath=()=>location.pathname.startsWith('/clientes/')?'Clientes':location.pathname.startsWith('/vendas/')?'Vendas':location.pathname.startsWith('/entregas/')?'Entregas':location.pathname.startsWith('/radar')?'Radar':location.pathname.startsWith('/estoque')?'Estoque':location.pathname.startsWith('/relatorios')?'Relatórios':location.pathname.startsWith('/configuracoes')?'Configurações':Object.entries(routes).find(([,path])=>path===location.pathname)?.[0] as Page||'Visão Geral'
