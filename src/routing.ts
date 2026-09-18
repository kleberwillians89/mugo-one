import {
  Boxes, CircleDollarSign, FileSpreadsheet, FileText, Home, Import, ListChecks, Lightbulb, MessagesSquare, Package, Radar, Settings, ShoppingBag, Sparkles, Truck, UserRound, UsersRound, Zap,
} from 'lucide-react'
import { FeatureCode } from './core/features/featureCatalog'

// 'Falta Splitar' (fila de fracionamento/split de frasco) foi isolada como
// legado — não é um conceito do Core do Mugô One. O código ainda existe em
// src/legacy/operations/pages/FaltaSplitarPage.tsx, mas não faz parte da
// navegação/roteamento ativos (ver src/legacy/operations/README.md).
//
// 'Davi Excel' (nome de pessoa, colunas nascidas de perfume) virou
// 'Planilha' — genérica, tecnologia de grade preservada (ver
// docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §2-4). Código antigo em
// src/legacy/spreadsheet/. Um bookmark para /davi-excel não quebra: cai
// no fallback 'Visão Geral' de pageFromPath, não em 404.
//
// 'Torre de Controle' (dashboard de contagens com nomes de pessoas
// codificados — "Davi", "Emily e Ilde") nunca foi um Task Engine, e
// virou 'Tarefas' — Kanban universal sobre a tabela `tasks` (Sprint
// K/L, ver docs/TASK_ENGINE_MIGRATION_PLAN.md). Código antigo em
// src/legacy/control-tower/. Um bookmark para /torre-de-controle cai
// no fallback 'Visão Geral', não em 404.
export type Page = 'Visão Geral'|'Tarefas'|'Conversas'|'Automações'|'Clientes'|'Vendas'|'Produtos'|'Planilha'|'Cobranças'|'Entregas'|'Estoque'|'Relatórios'|'Importação'|'IA'|'Insights'|'Radar'|'Interessados'|'Configurações'

export const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Tarefas', icon: ListChecks }, { label: 'Conversas', icon: MessagesSquare },
  { label: 'Automações', icon: Zap },
  { label: 'Planilha', icon: FileSpreadsheet }, { label: 'Produtos', icon: Package }, { label: 'Vendas', icon: ShoppingBag },
  { label: 'Cobranças', icon: CircleDollarSign },
  { label: 'Entregas', icon: Truck }, { label: 'Estoque', icon: Boxes },
  { label: 'Clientes', icon: UsersRound },
  { label: 'Relatórios', icon: FileText }, { label: 'Importação', icon: Import },
  { label: 'IA', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Radar', icon: Radar },
  { label: 'Interessados', icon: UserRound },
  { label: 'Configurações', icon: Settings },
]

export const routes:Record<Page,string>={'Visão Geral':'/','Tarefas':'/tarefas','Conversas':'/conversas','Automações':'/automacoes','Clientes':'/clientes','Vendas':'/vendas','Produtos':'/produtos','Planilha':'/planilha','Cobranças':'/cobrancas','Entregas':'/entregas','Estoque':'/estoque','Relatórios':'/relatorios','Importação':'/importacao','IA':'/ia','Insights':'/insights','Radar':'/radar','Interessados':'/interessados','Configurações':'/configuracoes'}

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
  'Visão Geral':['dashboard.view'],'Tarefas':['tasks.view'],'Conversas':['communications.view'],'Automações':['automations.view'],
  'Clientes':['clients.view'],'Vendas':['sales.view'],'Entregas':['shipping.view'],
  'Produtos':['catalog.view'],'Planilha':['sales.view'],'Cobranças':['sales.view'],
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
  'Tarefas':'tasks','Estoque':'inventory','Entregas':'shipping','Radar':'radar','Interessados':'waitlist','Conversas':'communications','Automações':'automations',
}

// '/configuracoes/equipe' (aba Equipe, ver TeamSettingsPage) não é uma rota
// exata do mapa `routes` (que só tem '/configuracoes') — sem este prefixo,
// pageFromPath cairia no fallback 'Visão Geral' tanto ao recarregar a URL
// direto quanto ao clicar "Equipe e acessos" (que navega via
// pushState+popstate, reusando esta função), jogando o usuário de volta
// para o Dashboard mesmo com a rota certa na barra de endereço.
export const pageFromPath=()=>location.pathname.startsWith('/clientes/')?'Clientes':location.pathname.startsWith('/vendas/')?'Vendas':location.pathname.startsWith('/entregas/')?'Entregas':location.pathname.startsWith('/radar')?'Radar':location.pathname.startsWith('/estoque')?'Estoque':location.pathname.startsWith('/relatorios')?'Relatórios':location.pathname.startsWith('/configuracoes')?'Configurações':Object.entries(routes).find(([,path])=>path===location.pathname)?.[0] as Page||'Visão Geral'
