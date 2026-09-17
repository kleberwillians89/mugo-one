# Legado isolado — "Torre de Controle"

Este diretório existe porque a Torre de Controle nunca foi um sistema
de tarefas — é um dashboard de contagens agregadas de outras filas de
domínio (vendas bloqueadas, cobranças, lista de espera, split, envios,
reposição, margem), com nomes de pessoas da operação antiga
codificados diretamente no tipo TypeScript e no texto renderizado
(`title="Davi"`, `title="Emily e Ilde"`). O sucessor ativo é o
**Task Engine** (`public.tasks` + `/tarefas`, Sprint K/L — ver
docs/TASK_ENGINE_MIGRATION_PLAN.md).

## O que está aqui

| Arquivo | Era acessível em | Motivo de existir |
|---|---|---|
| `ControlTowerPage.tsx` | Menu "Torre de Controle" (`/torre-de-controle`) | Dashboard de contagens por pessoa/fila operacional |
| `control-tower.ts` | Dentro da Torre | Agrega `fetchSalesValidationQueue`/`fetchClientRecoveryQueue`/`fetchWaitlistQueue`/`fetchSplitStatusCards`/`fetchOperationalShipments`/`fetchReplenishmentSignals` em um resumo só |
| `ControlTowerPage.css` | — | Estilo das colunas/linhas |

## O que isso significa na prática

- **Não apagamos nada.** O código continua aqui, compilando, tipado,
  só com os imports relativos ajustados para a nova localização (um
  nível a mais de profundidade).
- **Não está na navegação ativa.** `src/routing.ts` e `src/App.tsx`
  não importam nem roteiam para nenhum destes arquivos — o item de
  menu "Torre de Controle" deixou de existir, substituído por
  "Tarefas" (`/tarefas`, Task Engine universal).
- **As filas que a Torre agregava continuam funcionando** onde já
  funcionavam (`SalesPage` usa `fetchSalesValidationQueue` direto,
  `DeliveriesPage`/`CobrancasPage` idem) — só o dashboard-resumo que
  reunia tudo numa tela com nomes de pessoas é que saiu do produto
  ativo.
- **As permissions `tasks.sales`/`tasks.split`/`tasks.shipping`/
  `tasks.management`** continuam existindo em `PERMISSION_CATALOG`
  (espelho de uma migration histórica já aplicada, com um bloco de
  identidade por UUID de pessoas reais — não pode ser removida de lá),
  mas não gateiam mais nenhuma tela ativa. O Task Engine novo usa
  códigos próprios e distintos (`tasks.view`/`tasks.create`/
  `tasks.edit`/`tasks.assign`/`tasks.manage`).
