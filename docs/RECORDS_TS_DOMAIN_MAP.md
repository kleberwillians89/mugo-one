# Mapa de domínios — src/lib/records.ts

Documento pedido pela sprint 1 de productização (item 7 — records.ts):
mapear as fronteiras de domínio do "god file" (917 linhas antes desta
sprint) sem fazer uma refatoração grande. A única extração feita nesta
sprint foi o trio auth/organização (linhas 6-26 originais), movido para
`src/core/organizations/legacyOrganizationAccess.ts` com reexport — ver
seção "Auth / Organização" abaixo.

Os domínios abaixo estão **entrelaçados por linha** (não são blocos
contíguos) — é exatamente por isso que uma extração completa em uma
sprint só seria arriscada. Este mapa é o ponto de partida para futuras
extrações pequenas e seguras, uma de cada vez, cada uma com build verde
e testes de regressão antes de mover a próxima.

| Domínio | Linhas aproximadas (arquivo original) | Exemplos de exports | Nota |
|---|---|---|---|
| **Auth / Organização** | 1-26 | `authenticatedOrganization`, `currentOrganization`, `fetchOperationalSalesStartDate` | **Extraído nesta sprint** → `src/core/organizations/legacyOrganizationAccess.ts`, reexportado por compatibilidade |
| **Dashboard** | 28-90 | `DashboardMetrics`, `fetchDashboardMetrics`, `PeriodSummary`, `fetchPeriodSummary`, `DashboardActivityItem` | Candidato de extração pequena e segura para uma próxima sprint (pouco acoplado a outros domínios) |
| **Clientes / Portal / Comunicação (entrelaçados)** | 92-188 | `ClientCommercialSummary`, `Client360`, `fetchClient360`, `ClientPortalStatus`, `inviteCustomerAccount`, `uploadCollectionImage`, `sendManychatMessage`, `CustomerIdentityReview` | Três domínios diferentes na mesma faixa de linhas — cliente (CRM), portal do cliente e comunicação (ManyChat) — precisam ser separados antes de generalizar qualquer um dos três |
| **Vendas / Davi Excel** | 189-270 | `CommercialSale`, `SaleFilters`, `fetchDaviExcel`, `updateDaviExcelSale`, `softDeleteDaviSale`, `fetchDaviExcelDistinct` | Fortemente acoplado ao adapter "Davi Excel" (classe D da auditoria) — não extrair sem decidir o destino desse adapter primeiro |
| **Cobranças (collections)** | 271-309 | `CollectionSaleRow`, `fetchCollectionsPending`, `registerCollectionPayment` | Fila de contas a receber — padrão genérico, mas usa os mesmos tipos de `sales` |
| **Vendas / Envios / Logística** | 310-472 | `fetchSalesPage`, `fetchSale360`, `ReservedAllocation`, `fetchDeliveryRows`, `OperationalShipment`, `quoteShipment`, `createSuperFreteCart`, `ShippingSettings` | O maior bloco contíguo do arquivo; mistura CRUD de venda genérico com chamadas diretas às Edge Functions do SuperFrete (classe D) |
| **IA** | 473-507 | `askIntelligence` | Isolado e pequeno — outro bom candidato de extração futura |
| **Produtos (perfumes)** | 508-522, 698-763 | `PerfumeCommercialSummary`, `fetchPerfumeSummaries`, `searchPerfumes`, `createCanonicalPerfume` | Núcleo do que vira `products` genérico (ver auditoria, seção Produtos/serviços) |
| **Clientes (CRUD)** | 523-586 | `ClientInput`, `findPossibleClients`, `createClient`, `createDaviExcelClient`, `updateClient` | — |
| **Vendas (criação) / Importação IA** | 587-697 | `SaleInput`, `createSale`, `parseSaleAssistant`, `AiSalesBatchPreview`, `confirmAiSalesBatch`, `bootstrapAiBatchInventory` | — |
| **Estoque / Split** | 764-917 | `InventorySummary`, `fetchOperationalInventory`, `createInventoryItem`, `adjustInventory`, `SplitStatus*`, `setSplitStatusBulk` | Split/fracionamento (classe E da auditoria) misturado com estoque genérico (classe B) na mesma faixa |

## Recomendação para futuras sprints

Ordem sugerida de extração (do mais isolado/seguro para o mais
entrelaçado), sempre uma por vez com testes de regressão antes de mover
a próxima:

1. Dashboard (já quase isolado)
2. IA (`askIntelligence`, isolado)
3. Produtos/perfumes
4. Clientes (CRUD) — separar de Portal/Comunicação, que hoje estão na
   mesma faixa de linhas
5. Estoque — separar Split (candidato a plugin vertical) do núcleo
   genérico de estoque
6. Vendas + Envios/Logística — o bloco maior e mais arriscado, deixar
   por último
