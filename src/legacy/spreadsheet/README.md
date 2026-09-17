# Legado isolado — "Davi Excel"

Este diretório existe porque "Davi Excel" carregava o nome de uma
pessoa de outra empresa e nasceu com colunas de perfume/frasco/split —
não pertence ao Core genérico do Mugô One (ver
docs/ACTIVE_PRODUCT_GENERALIZATION_AUDIT.md §2-4). O sucessor ativo é
a **Planilha** (`src/pages/SpreadsheetPage.tsx` + `src/components/spreadsheet/`
+ `src/lib/spreadsheet-adapter.ts`).

## O que está aqui

| Arquivo | Era acessível em | Motivo de existir |
|---|---|---|
| `DaviExcelPage.tsx` | Menu "Davi Excel" (`/davi-excel`) | Grade comercial canônica original (13 colunas de venda de perfume) |
| `DaviExcelNewRows.tsx` | Dentro de Davi Excel | Criação de nova venda (perfume + frasco + ml obrigatórios) |
| `DaviImportDiagnostics.tsx` | Dentro de Davi Excel | Diagnóstico de importação/consistência do CRM |
| `DaviQuickClientModal.tsx` | Dentro da criação de venda | Cadastro rápido de cliente durante o lançamento |
| `*.css` | — | Estilos das telas acima |

## O que isso significa na prática

- **Não apagamos nada.** O código continua aqui, compilando, tipado,
  com toda a cobertura de teste original preservada (só os caminhos de
  `readFileSync` dos testes e os imports relativos internos foram
  atualizados para a nova localização — um nível a mais de profundidade).
- **Não está na navegação ativa.** `src/routing.ts` e `src/App.tsx` não
  importam nem roteiam para nenhum destes arquivos — o item de menu
  "Davi Excel" deixou de existir, substituído por "Planilha".
- **As RPCs `davi_excel_*`/`soft_delete_davi_sale` no banco continuam
  com esse nome.** Renomear função SQL não é uma migration aditiva —
  fica para uma fase futura, se um dia fizer sentido. A Planilha ativa
  consome essas mesmas RPCs através de `src/lib/spreadsheet-adapter.ts`
  (padrão adapter — nenhum nome "Davi" cruza essa fronteira para o
  resto do produto).
- **A Planilha ainda não cobre 100% do que esta tela cobria.** Ela lê e
  edita os campos genéricos (cliente, data, valor, pagamento,
  observações, anexos) através do mesmo registro operacional. Criação
  de novo item, e os campos ainda estruturalmente ligados a
  perfume/frasco/split (Item enquanto não editável, Tipo APC/SPLIT,
  data do split), continuam só aqui, e ficam disponíveis no produto
  genérico quando o modelo Produto/Serviço + Sale Items existir (Fase E
  da sprint de generalização).
- **Se algum dia formos apagar de verdade:** confirmar que nenhuma
  organização ativa depende mais da tela antiga, migrar dados
  residuais se houver, e só então remover pasta + RPCs específicas.
  Até lá, isolar é suficiente e reversível.
