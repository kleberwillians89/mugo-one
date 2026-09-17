# Plano de migração — Communication Hub Universal (Sprint N)

Auditoria do código/schema reais antes de qualquer migration nova.

## 1. Classificação do que já existe

| Item | Onde | Classe | O que fazer |
|---|---|---|---|
| `sendInviteEmail` (chamada HTTP à API do Resend) | `supabase/functions/_shared/customer-invite.ts` | **B** — mecânica HTTP reaproveitável (endpoint, header `authorization: Bearer`, `response.id` como `provider_message_id`, tratamento de erro), mas o CONTEÚDO é 100% acoplado ao convite "Minha RUAH" (assunto fixo, HTML com branding RUAH, `RUAH_INVITE_FROM`) | Não reaproveitar a função em si (é para convite de portal, outro domínio). Meu novo `ResendEmailAdapter` replica a MESMA mecânica HTTP comprovada, com conteúdo genérico |
| `sendInviteWhatsapp` (chamada HTTP à Graph API da Meta) | idem | **D** — legado vertical (template `minha_ruah_convite_acesso` fixo, fluxo de convite de portal, não mensageria de conversa) | Não tocar, não reaproveitar. Só confirma nomes de env var (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`) para quando existir um `MetaWhatsAppAdapter` futuro |
| `safeProviderError`/`maskedEmail` (sanitização de erro/PII antes de logar) | idem | **A** — padrão genérico já usado em 3 lugares (`customer-registration-start`, `customer-invite.ts`, `manychat-send`) | Replicar o MESMO padrão (mascarar e truncar) para `messages.error_message` |
| `sendManychatFlow`/`updateManychatCustomFields` (dispara Flow do ManyChat com custom fields de cobrança) | `supabase/functions/_shared/manychat.ts` + `supabase/functions/manychat-send/` | **D** — 100% acoplado ao fluxo de cobrança (`nome_cliente`/`numero_pedido`/`valor_pedido`, flows fixos de "collection"/"access") | Não reaproveitar o fluxo. É mensageria de UM flow pré-configurado no ManyChat, não "enviar uma mensagem" genérica — não é uma boa base para `WhatsAppProvider` |
| `normalizeBrazilianPhone`, `constantTimeEqual`, `withInFlightKey` | idem | **A** — utilitários genéricos (normalização de telefone BR, comparação em tempo constante para verificação de assinatura, dedupe de chamada concorrente por chave) | Reaproveitar `constantTimeEqual` para verificação de assinatura do webhook do Resend. `normalizeBrazilianPhone` já tem equivalente em `normalize_br_phone` (SQL, Sprint M) — usar o SQL, não duplicar em Deno |
| `integration_runs` (organization_id, provider, operation, entity_type, entity_id, idempotency_key, external_id, status, attempts, started_at, completed_at, error_code, safe_error_message, metadata, created_by) | schema (migration não identificada nesta busca, tabela já existe) | **A** — padrão genérico de tracking de operação externa | Não reaproveitar a tabela em si (mensagens precisam de forma própria — conversation_id, direction, corpo), mas replicar a MESMA convenção de nomes (`error_code`/`safe_error_message`→`error_message`, `idempotency_key`) |
| Feature `communications` (`is_core=false`, label "Comunicação", descrição "Canais de WhatsApp, e-mail e SMS.") | `supabase/migrations/202609170001_organization_settings_and_features.sql` + `src/core/features/featureCatalog.ts` | **A** — já existe, especulativamente seedada na Fase A-D | **Não recriar.** Só gatear a nova UI/rota por ela. Continua opt-in (`is_core=false`) — nada nesta sprint pede torná-la core |
| Buckets de storage privados + signed URL (`sale-payment-attachments`) | `supabase/migrations/202608230009_sale_payment_attachments.sql` + `src/lib/sale-payment-attachments.ts` | **A** — padrão universal comprovado (bucket privado, RLS em `storage.objects`, `createSignedUrl` client-side) | Documentado para quando anexos de mensagem forem implementados (não nesta sprint, §46) — não construído agora |
| Supabase Vault / pgsodium | busca em todas as migrations | **Ausente** | Decisão: não usar Vault. Segredos de provider continuam só em variáveis de ambiente de Edge Function (`Deno.env.get`), mesmo padrão já usado por SuperFrete/ManyChat/Resend-convite/WhatsApp-convite — nenhuma migration nova precisa disso |
| `ai_conversations`/`ai_messages` | schema | **E** — não relacionado; é o chat do Assistente de IA (role user/assistant, `content jsonb`), domínio totalmente diferente | Nomes `conversations`/`messages` (sem prefixo `ai_`) confirmados livres — sem colisão |
| `client_accounts.sent_email_at`/`sent_whatsapp_at`/`invite_last_error` | schema | **D** — tracking específico do fluxo de convite de portal do cliente, não mensageria de conversa | Não tocar |

## 2. Não arrastar legado

Confirmado nesta auditoria: nenhum fluxo de negócio específico (ManyChat de cobrança, convite de portal, rastreamento de perfume) é copiado. Só a MECÂNICA de HTTP/normalização/sanitização é replicada, nunca o conteúdo/regra de negócio.

## 3. Decisão: HTTP de provider vive em Edge Function, nunca em RPC

Confirmado (mesmo padrão de `customer-registration-start`/`manychat-send`, e ausência de `pg_net` em uso neste projeto): o envio real (chamada HTTP ao Resend) acontece em uma Edge Function (`send-email`, autenticada via Bearer do usuário — não pública), nunca dentro de uma função SQL. A RPC (`send_communication_message` ou equivalente) só existe para o caminho `mock`/QA e para criar a linha de `messages` em `queued` antes do envio real.

## 4. Modelo de dados (nomes finais)

`conversations`, `messages`, `communication_identities`, `communication_connections` — campos conforme o briefing, com um campo prático adicional: `conversations.connection_id` (FK para `communication_connections`), necessário operacionalmente para saber qual conexão/remetente usar ao enviar — o briefing já cita `provider`/`provider_account_id` como campos descritivos; `connection_id` é o vínculo real usado pela Edge Function.

## 5. Diferença message vs. touchpoint vs. activity (briefing §36/§37)

- **message** = conteúdo (o texto/mídia em si, com status de entrega) — fonte de verdade da comunicação, nunca duplicado em outro lugar.
- **touchpoint** = atribuição/interação (que já existe desde a Sprint M) — um inbound relevante gera UM touchpoint (`channel`/`provider`/`occurred_at`), sem o corpo da mensagem.
- **activity** = evento operacional relevante da timeline (`conversation_started`/`conversation_closed`) — nunca uma por mensagem (viraria spam, briefing §32).

## 6. Identity resolution: reaproveitada, não duplicada

`communication_identities` é uma tabela de IDENTIDADE DE CANAL (qual telefone/e-mail/ID de provider pertence a qual entidade), não um motor de resolução novo. A resolução de "esse telefone é de qual Customer" continua usando exatamente a mesma lógica conservadora da Sprint M (match exato por documento/e-mail/telefone normalizado contra `clients`, nunca fuzzy, nunca automático em caso de ambiguidade) — `communication_identities` é só onde perguntas futuras tipo "todos os canais desta entidade" são respondidas sem reconsultar `clients.normalized_*` toda vez.

## 7. Task Engine: `create_task` ganha `p_metadata` opcional (não um novo entity_type)

Confirmado: `tasks.metadata jsonb` já existe na tabela (Sprint K/L) mas `create_task()`/`NewTaskInput` não expõem esse campo. Em vez de adicionar `'conversation'` a `entity_belongs_to_organization`/`tasks.entity_type` (que o briefing explicitly pede para NÃO fazer sem avaliar), a tarefa criada a partir de uma conversa usa `entity_type`/`entity_id` do Customer/Lead já vinculado à conversa (já suportado) e carrega `conversation_id` dentro de `metadata` — uma migration pequena e aditiva adiciona `p_metadata jsonb default '{}'` ao `create_task`, sem tocar `entity_type`.

## 8. Achados adicionais (auditoria complementar)

- `docs/RUAH_HARDCODE_CATALOG.md` já nomeia esta sprint como **"Fase 9 (Communication Engine)"** e já sinalizava o hardcode de `RUAH_ORGANIZATION_ID` em `customer-registration-start`/`whatsapp-customer-balance` como bloqueio para "a forma correta de resolver o tenant num endpoint público multi-tenant" — exatamente o problema que `lead_intake_endpoints`/`communication_connections` resolvem (chave/conexão por organização, nunca um env var global de organização única). Confirma que o padrão de endpoint-por-organização (Sprint M) é a correção certa a aplicar aqui, não um padrão novo.
- **Três normalizadores de telefone BR distintos já existem no repositório**: `normalize_br_phone` (SQL, sem `+`), `normalizeBrazilianPhone` (`_shared/manychat.ts`, COM `+`, valida regex), `cleanPhone` (`_shared/customer-invite.ts`, sem `+`, sem validação). Decisão: o Communication Hub NÃO cria um quarto — reaproveita `normalize_br_phone` (SQL) via chamada de RPC quando uma Edge Function precisar normalizar, mesmo padrão já usado pela Sprint M.
- `touchpoints.entity_type` **não** ganha `'conversation'` nesta sprint — o comentário original da Sprint M já cogitava isso como candidato futuro, mas mantém a semântica mais consistente: touchpoint continua sendo atribuição contra uma IDENTIDADE resolvida (customer/company/contact/lead), nunca contra um container de conversa. Um inbound relevante gera touchpoint no customer/lead vinculado à conversa — não na conversa em si (briefing §36, mesmo raciocínio de `lead_intake_events`→touchpoint na Sprint M).
- `activities.entity_type`/`entity_belongs_to_organization` **precisam** ganhar o case `'conversation'` nesta sprint (`conversation_started`/`conversation_closed`, briefing §32) — diferente de touchpoints. Migração feita na MESMA migration que introduz o primeiro uso (lição da Sprint E/F e K/L, ver docs anteriores).
- `sendInviteEmail`/`sendInviteWhatsapp`/ManyChat (`manychat-send`) seguem 100% fora de escopo — não tocados, não reaproveitados como mecanismo de envio (só a mecânica HTTP do Resend serviu de referência, já registrado acima).
- Dívida de isolamento identificada, mas **fora do escopo desta sprint** (não pedida no briefing, não faz parte de "não arrastar legado" tocar código já em produção sem pedido explícito): `src/pages/CobrancasPage.tsx`/`src/components/CollectionSummaryImageCard.tsx` ainda vivem em `src/` geral (não `src/legacy/`), com template de mensagem, CNPJ e razão social da RUAH hardcoded. Registrado aqui para uma sprint de limpeza futura — o Communication Hub novo não referencia nem depende desses arquivos.
- Nenhum provider de SMS (GTI/Zenvia/Twilio) existe hoje — confirma que a arquitetura de `channel='sms'` desta sprint é 100% preparação, sem nada para reaproveitar ou conflitar.

## 9. Reaproveitamentos diretos de frontend

- `EntityCombobox` (`src/components/ui/EntityCombobox.tsx`) — genérico por `search` function, reaproveitado tal como está para o picker de destinatário em "Nova Conversa".
- `searchRelatableEntities()` (`src/lib/tasks.ts`) — já busca customer/company/contact/lead por nome; importado diretamente, não duplicado.
- `EntityTasksBlock` — botão "Criar tarefa" da conversa usa o mesmo componente já existente, só populando `defaultEntityType`/`defaultEntityId` a partir da conversa.
