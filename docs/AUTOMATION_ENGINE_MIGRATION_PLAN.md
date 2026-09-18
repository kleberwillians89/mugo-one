# Plano de migração — Event Engine + Automation Engine (Sprint O)

Auditoria do que já existe antes de qualquer migration nova.

## 1. Activity vs. Event — já formalizado, mas nunca como "evento de domínio"

`activities`/`log_activity()` (desde a Sprint 3, ampliado em toda sprint seguinte) já é o histórico humano — usado por CRM/Task Engine/Lead Intake/Communication Hub. Ele NÃO serve de gatilho de automação hoje (nenhum trigger lê `activities` para decidir agir) e seu `metadata` é livre/não-tipado, pensado para exibição, não para avaliação de condição. `domain_events` (novo) é o fato técnico — imutável, com `event_type` fechado por convenção de nomenclatura (`entidade.verbo`), payload mínimo e tipado o suficiente para condições. **Nenhuma automação lê `activities`; nenhuma activity é substituída por `domain_events`.** As duas continuam existindo em paralelo, cada uma com seu próprio propósito — documentado explicitamente para não confundir os dois no futuro (briefing §2).

## 2. RPCs existentes que já fazem a mudança de domínio (pontos de emissão)

| RPC existente | Evento(s) a emitir | Observação |
|---|---|---|
| `lead_intake_submit` (Sprint M) | `lead.created`, `lead_intake.processed`, `identity.conflict` | Já é o único ponto de escrita de `leads` a partir de intake externo — emissão entra na MESMA transação, sem duplicar |
| `convert_lead` (Sprint 3) | `lead.converted` | Único caminho de conversão Lead→Customer |
| `create_task`/`update_task_status`/`assign_task` (Sprint K/L, ampliado na Sprint N com `p_metadata`) | `task.created`, `task.started`/`task.completed`/`task.reopened`/`task.cancelled` (conforme a transição real), `task.assigned` | `update_task_status` já deriva o tipo de activity pela transição from→to — mesmo racional serve para o evento |
| `move_deal_stage` (Sprint 3) | `deal.stage_changed` sempre; `deal.won`/`deal.lost` adicionalmente quando `pipeline_stages.stage_type` do destino for `'won'`/`'lost'` (constraint já existente: `stage_type in ('open','won','lost')`) | Nenhum RPC `create_deal` dedicado existe — deals nascem por INSERT direto sob RLS; `deal.created` não tem um ponto único de emissão ainda (documentado como gap, não implementado via trigger nesta sprint para não introduzir uma segunda fonte de verdade — ver §8 abaixo) |
| `create_sale_with_items` (Sprint E/F) | `sale.created` | Única RPC de criação de venda com itens |
| `resolve_or_create_conversation`/`set_conversation_status` (Sprint N) | `conversation.created`, `conversation.closed` | `resolve_or_create_conversation` já é chamada internamente por `send_communication_message`/`simulate_inbound_message` — ponto único |
| `simulate_inbound_message`/`update_message_delivery_status` (Sprint N) | `message.received`, `message.sent`/`message.delivered`/`message.failed` | `update_message_delivery_status` já tem guarda de não-regressão de status — o evento só é emitido na transição real aplicada, nunca em uma ignorada (`ignored_out_of_order`) |

## 3. Duplicidade potencial identificada e decisão

`update_task_status` já loga uma activity com o tipo derivado da transição (`task_started`/`task_completed`/etc. — nome exato a confirmar no código). Emitir `domain_events` na MESMA função, a partir da MESMA transição já calculada, evita duas fontes de verdade (nunca recalcular a transição duas vezes). Mesma lógica para `update_message_delivery_status`. **Fonte de verdade de cada evento = a própria RPC de domínio que já existe — nunca um trigger paralelo lendo a tabela depois.**

## 4. `deal.created` — gap documentado, não implementado via trigger nesta sprint

Deals são inseridos diretamente pelo frontend (`insert into deals ...` sob RLS), sem RPC dedicada. Criar um trigger `AFTER INSERT ON deals` para emitir `deal.created` introduziria uma SEGUNDA fonte de emissão de evento (trigger, não RPC) — inconsistente com a decisão de "cada operação tem UMA fonte responsável" (briefing §8). Nesta sprint, `deal.created` fica **documentado no catálogo de eventos mas sem emissor** — não bloqueia a sprint (nenhum QA pede automação em `deal.created`) e evita abrir uma exceção à regra no primeiro evento implementado. Registrado como próximo passo: migrar criação de deal para uma RPC dedicada (fora do escopo desta sprint) antes de emitir esse evento.

## 5. Infraestrutura disponível — decide a arquitetura do worker

Confirmado por auditoria direta: **nem `pg_cron` nem `pg_net` estão instalados neste projeto.** Isso significa: (a) Postgres não pode fazer HTTP saindo (nenhuma RPC pode chamar o Resend diretamente — já era a convenção do projeto, ver Sprint N); (b) não há scheduler dentro do banco para processar fila periodicamente. Decisão: nenhuma automação depende de cron. Actions 100% SQL (`create_task`) são executadas **de forma síncrona, dentro da mesma transação de `emit_domain_event`** — sem fila, sem worker, sem latência. Actions que precisam de HTTP (`send_email`) só CRIAM a `message` em `queued` (reaproveitando `send_communication_message`, Sprint N) durante essa mesma transação; o envio de verdade acontece numa Edge Function `automation-worker`, invocada explicitamente pelos pontos de entrada que já são Edge Functions (`lead-intake`) ou por uma chamada best-effort do frontend logo após operações que emitem evento — nunca por polling. Documentado em detalhe na migration do worker.

## 6. `entity_belongs_to_organization` / `activities.entity_type` — não precisam de novo case

`domain_events`/`automations`/`automation_runs` não são, elas mesmas, alvo de `log_activity` nem de touchpoint — não precisam entrar em `entity_belongs_to_organization`. `entity_type`/`entity_id` dentro do PAYLOAD de um evento (ex.: `lead`/`deal`/`task`) apontam para entidades JÁ suportadas por essa função — reaproveitadas apenas para validação quando uma action referencia uma entidade (ex.: `create_task` action valida a entidade relacionada exatamente como o Task Engine já faz).

## 7. Permissões e feature flag

Novo módulo `automations` (`automations.view/create/edit/manage`, sem permissão por action — briefing §40). Nova feature `automations` (`is_core=false` — começa desativada por padrão, briefing §76), seguindo o padrão já usado por `communications`/`lead_intake`.
