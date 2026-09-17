# Auditoria de generalização do produto ativo — Mugô One

FASE A da sprint "GENERALIZAÇÃO COMPLETA DO PRODUTO ATIVO MUGÔ ONE".
Escopo: `src/App.tsx`, `src/routing.ts`, `src/pages/`, `src/components/`,
`src/lib/`, `src/modules/`, `src/core/`. Gate: nenhuma alteração de código
foi feita antes deste mapa existir.

Classificação:
- **A — GENERIC CORE**: permanece como está.
- **B — GENERALIZABLE**: tecnologia madura, precisa trocar o modelo de domínio.
- **C — VERTICAL LEGACY**: só faz sentido para a operação antiga; sai do produto ativo (isolar, não deletar).
- **D — OPTIONAL MODULE**: genérico, mas nem toda organização precisa (feature flag).

## 1. Menu / rotas ativas (`src/routing.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`)

Hoje o `Page` union tem 15 itens. O módulo CRM novo (`src/modules/crm`:
companies/contacts/leads/deals/pipelines) **não tem nenhuma página de UI
ainda** — só camada de dados/RLS das Sprints 2/3. Por isso "Empresas",
"Contatos", "Leads", "Pipeline" não entram no menu nesta sprint (regra do
próprio briefing: não criar página fake para o que não existe).

| Item de menu atual | Classe | Observação |
|---|---|---|
| Visão Geral (Dashboard) | B | ver §6 |
| Torre de Controle (Tarefas) | C | nomes de pessoas + `split`/`frasco` no corpo; Task Engine genérico ainda não existe |
| Clientes | A | já é CRM genérico (customer/client), some perfume só no histórico de compras exibido |
| Vendas | B | ver §5 |
| Davi Excel | B | ver §4 |
| Cobranças | B | reaproveita `perfume`/nome "Davi" em textos de cobrança; lógica de pagamento é genérica |
| Entregas | D | logística é conceito genérico, mas depende de `perfume`/`split` hoje — ocultar por feature flag até generalizar |
| Estoque | D | estruturalmente `perfume`/`bottle`/`split` — ocultar por feature flag até generalizar |
| Relatórios | B/C misto | ver §8 |
| Importação | B | importador é genérico (CSV/XLSX → mapeamento); nenhum termo vertical na página em si |
| IA | A | wrapper de período, sem termos verticais na página |
| Insights | A | sem termos verticais na página |
| Radar | C | 42 ocorrências de `perfume`; monitoramento de mercado de perfumes — remover da navegação padrão |
| Interessados (Waitlist) | C | 100% "lista de espera de perfume" — remover da navegação padrão |
| Configurações | A | Frete/Equipe; `TeamSettingsPage` já filtra `LEGACY_ONLY_PERMISSION_CODES` da grade ativa |

**Decisão Fase B**: usar a feature-flag foundation já existente
(`src/core/features/featureCatalog.ts` + `organizationFeatures.ts`,
tabela `organization_features`/`has_organization_feature`, Sprint 1) —
hoje pronta mas **nunca consumida por nenhuma página**. `inventory` e
`shipping` já estão marcados `isCore:false` no catálogo, ou seja, uma
organização nova sem linha em `organization_features` já deveria ficar
sem esses módulos — só falta o frontend respeitar isso.

## 2. Vendas (`src/pages/SalesPage.tsx`, `src/pages/SaleDetailsPage.tsx`, `src/components/RecordModals.tsx::SaleModal`)

Classe **B**. Confirmado por leitura completa:
- `SaleModal` pede literalmente: `perfume` (`EntityCombobox` de "Perfume
  *"), `saleType: 'APC'|'SPLIT'`, `ml`, `bottleNumber`, disponibilidade
  em ml.
- `SalesPage` tem colunas fixas `perfume_name_raw`, `bottle_identifier`,
  `sale_type`, `volume_ml`; filtro "Perfume A–Z"/"Busca por perfume";
  drawer de filtros com campo "Perfume" e "Frasco".
- `SaleDetailsPage`/`SaleDetails` mostram "Perfume"/"Frasco" como campos
  fixos da venda.
- Tudo depende de `CommercialSale`/`SaleFilters`/`createSale`/
  `fetchSalesPage`/`searchPerfumes` em `src/lib/records.ts`, que assume
  1 venda = 1 perfume = 1 frasco.

Alvo das Fases D/E/F: `SALE` + `SALE_ITEMS` genéricos, `products`
catálogo, novo `SaleModal` com itens dinâmicos.

## 3. Davi Excel (`src/pages/DaviExcelPage.tsx`, `src/components/DaviExcelNewRows.tsx`, `src/components/DaviImportDiagnostics.tsx`, `src/components/DaviQuickClientModal.tsx`, `src/lib/davi-import-diagnostics.ts`)

Classe **B**. Nome próprio de pessoa no nome do módulo (proibido pelo
§22 do briefing) + colunas de perfume. Tecnologia madura de grid
(filtro por coluna, ordenação, edição inline, exportação, anexos,
paginação, seleção) é o valor real — alvo da Fase C: `Spreadsheet` /
`SpreadsheetPage` genérica, código Davi antigo isolado em
`src/legacy/`.

## 4. Estoque (`src/pages/InventoryPage.tsx`, `src/pages/InventoryCountPage.tsx`, `src/pages/InventoryStationPage.tsx`, `src/lib/inventory-bottles.ts`, `src/components/bottles/*`)

Classe **D** com risco alto de C. Estruturalmente baseado em
`perfume`/`bottle`/`split` (confirmado: colunas "Perfume", "Bottle" em
`InventoryPage.tsx`). Generalizar agora (opção A do §15) exigiria
reescrever todo o pipeline de estoque operacional — risco desnecessário
nesta sprint. **Decisão: opção B do próprio briefing** — remover da
navegação padrão de organizações novas via feature flag (`inventory`
já `isCore:false`), sem fingir que já é genérico.

## 5. Entregas (`src/pages/DeliveriesPage.tsx`, `src/components/ShipmentOperations.tsx`, `src/lib/legacy-shipping.ts`, `src/lib/shipping-tasks.ts`)

Classe **D**. Menos acoplado que Estoque (poucas ocorrências de
`perfume`, nenhuma estrutural em `DeliveriesPage.tsx` em si — aparecem
em textos/itens exibidos), mas ainda depende de conceitos operacionais
da RUAH (conferência de frasco, etc. — já confirmado nas sprints
anteriores). **Decisão: feature flag (`shipping`, já `isCore:false`)**
até a generalização real de logística.

## 6. Dashboard (`src/pages/Dashboard.tsx`, `src/lib/intelligent-dashboard.ts`)

Classe **B**. Página em si é só orquestração (48 linhas); as métricas
verticais (`ml`, `Perfume A-Z`, `volume_ml`, `split`) vêm do lib. Alvo
da Fase G: métricas universais (Receita, Vendas, Clientes, Novos
clientes, Ticket médio, Negócios abertos, Pipeline, Pagamentos
pendentes, Tarefas, Conversão) com empty state real quando não houver
dado — nunca zero fake.

## 7. Torre de Controle / Tarefas (`src/pages/ControlTowerPage.tsx`, `src/lib/control-tower.ts`)

Classe **C** por enquanto. Já confirmado nas sprints anteriores (coluna
"Gabriel"/tesoura removida no hotfix de split); ocorrências residuais
de `davi`, `Emily`, `split`, `frasco`, `perfume` seguem no corpo do
arquivo. Não existe Task Engine genérico ainda (§14 do briefing). Até
existir, esta tela não pertence à navegação padrão de organizações
novas — mesma técnica de feature flag (`tasks` já é `isCore:true` no
catálogo, o que está ERRADO para o estado atual: o conteúdo de
`tasks` hoje é 100% a Torre de Controle vertical, não um Task Engine
genérico). Fase H precisa decidir: ou `tasks` deixa de ser core até o
Task Engine existir, ou a Torre de Controle é escondida por outro
critério independente do feature catalog.

## 8. Relatórios (`src/pages/ReportsPage.tsx`, `src/pages/MarginReportPage.tsx`, `src/pages/Insights.tsx`, `src/pages/Intelligence.tsx`)

Misto:
- `ReportsPage.tsx` (20 linhas) — **A**, sem termo vertical.
- `MarginReportPage.tsx` — **C**, 13 ocorrências de termos verticais
  (margem por ml/perfume). Relatório específico da operação antiga.
- `Insights.tsx` (23 linhas) — **A**.
- `Intelligence.tsx` (32 linhas) — **A**, 1 ocorrência isolada (a
  auditar em detalhe na Fase I).

## 9. Radar / Interessados / Reposição

Classe **C**, confirmando o §17 do briefing:
- `RadarPage.tsx` (557 linhas, 42 ocorrências de "perfume") +
  `RadarSuppliersPage.tsx` — monitoramento de mercado de perfumes.
- `WaitlistPage.tsx` — 100% "lista de espera de perfume".
- `ReplenishmentPage.tsx` — 100% "reposição de perfume".

Tecnologia (scraping/matching/radar engine) pode ser valiosa como
`legacy`, mas a navegação padrão de uma organização nova não deve
mostrar nenhuma dessas três.

## 10. Importação (`src/pages/ImportPage.tsx`, `src/lib/importer.ts`, `src/components/AiSalesBatchImport.tsx`)

Classe **B**. `ImportPage.tsx` em si (64 linhas) não tem termo
vertical — o acoplamento a perfume está nos importadores específicos
por trás dela (scripts/, `AiSalesBatchImport`). Fase I generaliza a
interface de mapeamento de colunas (Customer/Company/Contact/
Product-Service/Sale/Sale Item/Custom Field); importadores antigos
viram legacy adapters.

## 11. CRM (`src/pages/ClientsPage.tsx`, `ClientDetailsPage.tsx`, `ClientRecoveryPage.tsx`, `CustomerIdentityReviewsPage.tsx`)

- `ClientsPage.tsx` — **A**, 3 ocorrências (histórico de compras
  exibindo nome do item, não estrutural).
- `ClientDetailsPage.tsx` — **A** com ressalva: 28 ocorrências, mas são
  o histórico de compras do cliente (mostra `perfume_name_raw` da
  venda) — decorre diretamente da generalização de Vendas (Fase D/E/F);
  não precisa de trabalho próprio além de consumir o novo modelo de
  `sale_items`.
- `ClientRecoveryPage.tsx`, `CustomerIdentityReviewsPage.tsx` — **A**,
  zero ocorrências.

## 12. Configurações (`src/pages/TeamSettingsPage.tsx`, `src/components/ShipmentOperations.tsx::ShippingSettingsPage`)

- `TeamSettingsPage.tsx` — **A**. As 6 ocorrências são o filtro já
  existente `ACTIVE_PERMISSION_CATALOG = PERMISSION_CATALOG.filter(e =>
  !LEGACY_ONLY_PERMISSION_CODES.has(e.code))` — proteção correta desde
  o hotfix "zero split", não um resíduo.
- `ShippingSettingsPage` — **D**, casada com o módulo Entregas.

## 13. IA / Insights (prompts)

A auditar em detalhe na Fase I (`src/lib/ai-import-preview-summary.ts`,
`src/lib/ai-import-summary.ts`, `src/lib/ai-inventory.ts`,
`src/lib/market-signals.ts`, `src/lib/radar*.ts`). Vocabulário universal
alvo: cliente, empresa, contato, lead, negócio, produto, serviço,
venda, pagamento, atividade, tarefa.

## 14. `src/core/` e `src/modules/`

Zero ocorrências de termos verticais (`Davi|Gabriel|Emily|Ilde|perfume|
frasco|bottle|volume_ml|split|fracionamento|brinde|APC`) — confirmado
por varredura. Classe **A** integralmente; é o Core novo construído do
zero nas Sprints 1–3, já limpo por construção.

## 15. Resumo por classe

| Classe | Telas/módulos |
|---|---|
| A | Clientes, ClientDetailsPage (após Fase D/E/F), ClientRecoveryPage, CustomerIdentityReviewsPage, Configurações (Equipe), ReportsPage, Insights, Intelligence, IA, todo `src/core`, todo `src/modules` |
| B | Vendas (SalesPage/SaleDetailsPage/SaleModal), Davi Excel → Planilha, Dashboard, Importação, Cobranças |
| C | Torre de Controle, Radar, Interessados, Reposição, MarginReportPage |
| D | Estoque, Entregas (+ ShippingSettingsPage) |

## 16. Não fazer nesta fase

Confirma-se, por auditoria, que os seguintes NÃO precisam de trabalho
novo além de generalização por decorrência (Fase D/E/F): `ClientDetailsPage`
histórico de compras. Nenhuma página de CRM (Empresas/Contatos/Leads/
Pipeline) será criada nesta sprint — não existe UI ainda, criar uma
"para não deixar vazio" violaria a regra explícita do briefing.
