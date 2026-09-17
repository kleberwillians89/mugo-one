# Plano de migração — Task Engine Universal + Kanban (Sprints K/L)

Auditoria obrigatória antes de qualquer migration nova. Conclusão
central, confirmada por leitura direta do código: **a Torre de
Controle não é um sistema de tarefas — é um dashboard de contagens
agregadas de outras filas de domínio (vendas bloqueadas, cobranças,
lista de espera, split, envios, reposição, margem).** Não existe hoje
nenhuma tabela com um registro de tarefa individual (título, descrição,
status, prioridade, prazo, responsável). O Task Engine desta sprint
nasce do zero, não generaliza a Torre.

## Classificação do legado

| Item | Classe | Nota |
|---|---|---|
| `src/pages/ControlTowerPage.tsx` + `src/lib/control-tower.ts` | **C — legado vertical** | `ControlTowerSummary` tem literalmente `davi`/`gabriel`/`entregas`/`gestao` como chaves do tipo — nomes de pessoas da operação antiga codificados no schema TypeScript. Zero conceito de tarefa individual; é agregação de outras 6+ queries de domínio (`fetchSalesValidationQueue`, `fetchClientRecoveryQueue`, `fetchWaitlistQueue`, `fetchSplitStatusCards`, `fetchOperationalShipments`, `fetchReplenishmentSignals`). Já oculta por padrão para organizações novas desde a Fase B (feature flag `tasks`, então `is_core=false`). Vira legacy/off nesta sprint (ver §37 do briefing) — fisicamente isolada, não apagada. |
| `public.task_assignments` (`202608190003_task_delegation.sql`) | **B — tecnologia reutilizável mas acoplada** | Padrão "reivindicar → imutável → resolver" genuinamente bom (mesma ideia que `inventory_bottles`/`conference_owner`), mas `entity_type check (in ('blocked_sale','waitlist_item','customer_recovery'))` — hardcoded às 3 filas antigas, e sem `title`/`description`/`status`/`priority`/`due_at`. Não é a forma de uma Task real; é um registro de "quem está cuidando de X", não "o que precisa ser feito". Não generalizada nem reaproveitada diretamente — o Task Engine novo tem forma própria (ver §Modelo). Continua existindo, sem alteração, servindo as 3 filas antigas. |
| Permissions `tasks.sales`/`tasks.split`/`tasks.shipping`/`tasks.management` (`202609120003_role_scoped_tasks.sql`) | **C — legado vertical, e mais: histórico sensível** | Esta migration (já aplicada, nunca alterada) tem um bloco `do $$ ... end $$` que valida identidade por UUID de usuários reais específicos (davi/emily/ilde/gabriel) antes de rodar — é literalmente acoplada a pessoas da operação RUAH, não um exemplo, o dado real. `tasks.split` já está em `LEGACY_ONLY_PERMISSION_CODES` desde a sprint "zero split". As 4 permissions continuam existindo (gate da Torre antiga) — o Task Engine novo usa códigos **novos e distintos** (`tasks.view`/`tasks.create`/`tasks.edit`/`tasks.assign`/`tasks.manage`), nunca reaproveita esses 4. |
| `fetchSalesValidationQueue`/`assignBlockedSale` (`src/lib/sales-validation.ts`) | **B — tecnologia reutilizável mas acoplada** | Fila de "vendas bloqueadas" com um botão "Assumir" — mesmo espírito de tarefa, mas é uma RPC dedicada à validação de vendas, não uma Task genérica. Fica como está; `SalesPage` continua usando. Fora de escopo desta sprint generalizar. |
| `fetchClientRecoveryQueue`, `fetchWaitlistQueue`, `fetchReplenishmentSignals`, `fetchSplitStatusCards`, `shipping-tasks.ts` | **C/D — legado vertical** | Cada uma já classificada nas sprints de generalização anteriores (Fase A: Radar/Interessados/Reposição saem da navegação padrão; Estoque/Entregas ficam atrás de feature flag). Não tocadas aqui. |
| `assignee`/`responsável` em `SalesPage`/`NewSaleModal` (`owner_user_id` em `sales`) | **A — universal e reutilizável (padrão, não código)** | `sales.owner_user_id` (Fase E) já estabeleceu o padrão "responsável = membro ativo da mesma organização" que o Task Engine reaproveita conceitualmente — mesma validação, campo próprio na nova tabela. |

## Decisão

Task Engine é uma tabela nova (`tasks`), permissions novas, RLS nova,
Kanban novo em `/tarefas`. Torre de Controle physically isolada em
`src/legacy/` quando `/tarefas` estiver pronto — nada do código dela é
generalizado ou reaproveitado como base do Task Engine; só a
*validação de conceito* (assignee ativo, tenant-safe) é reaproveitada
como padrão de design, não como código compartilhado.
