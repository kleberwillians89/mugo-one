# Auditoria — Resíduo ativo da Ruah em Cobranças (Sprint de Limpeza)

Auditoria do código e banco reais antes de qualquer alteração.

## Classificação

**A** — bug ativo (precisa ser corrigido nesta sprint) · **B** — provider-specific mas tecnologia genérica · **C** — deveria estar isolado em `src/legacy/`, ainda não está · **D** — histórico/doc, aceitável · **E** — citação histórica em teste, aceitável (protege contra o bug, não contém o bug).

## A — Bugs ativos (Cobranças, escopo principal desta sprint)

| Onde | O quê | Classe |
|---|---|---|
| `src/pages/CobrancasPage.tsx:28` (`buildMessage`) | Mensagem inteira hardcoded: `"Bi biiiiiiii 🚗💨✨\nO carrinho da cobrança da Ruah..."`, CNPJ **67.819.967/0001-70**, razão social **GI Cosméticos LTDA**, `"Obrigada por escolher a Ruah Parfums!"` | **A** |
| `src/pages/CobrancasPage.tsx:124,202` | `s.perfume_name??'Perfume'`, `s.sale_type`, `s.volume_ml` renderizados na lista/modal de pagamento | **A** |
| `src/pages/CobrancasPage.tsx:184` | Placeholder de busca: `"Buscar cliente, número do cliente ou perfume"` | **A** |
| `src/pages/CobrancasPage.tsx:88` (`CollectionWhatsAppDispatch`) | Chama `sendManychatMessage(...)` diretamente — Core dependendo de ManyChat como regra de negócio | **A** |
| `src/components/CollectionSummaryImageCard.tsx:24` | `<img src="/ruah-brand.svg" alt="RUAH Parfums"/>` | **A** |
| `src/components/CollectionSummaryImageCard.tsx:33-35` | `sale.perfume_name`, `sale.perfume_brand`, `sale.volume_ml` no card exportado como imagem | **A** |
| `src/components/CollectionSummaryImageCard.tsx:44` | `"RUAH PARFUMS • Conferência de pedidos em aberto"` | **A** |
| `src/lib/records.ts` (`CollectionSaleRow`) | Type com `perfume_name`/`perfume_brand`/`volume_ml`/`sale_type` — espelha o RPC vertical | **A** |
| `supabase/migrations/*.sql` — `collections_pending_sales_canonical` | `RETURNS TABLE(..., perfume_name text, perfume_brand text, ...)`, `join public.perfumes p on p.id=s.perfume_id`, `volume_ml` | **A** |
| idem — `collections_pending_sales_operational` | Mesmo shape (delega para `_canonical`) | **A** |
| idem — `collections_pending_sales` (a que o frontend chama) | Mesmo shape + busca filtra por `pending.perfume_name ilike ...` | **A** |

**Decisão**: reescrever as 3 RPCs para devolver só campos universais (id, client, sale_date, amount, payment_status, contadores de tentativa de cobrança) — sem join com `perfumes`. O resumo do item (hoje "perfume + tipo + ml") passa a vir do **mesmo mecanismo já usado em Vendas/Planilha** (`fetchSaleItemsSummaries`/`itemsSummaryLabel` de `src/lib/sale-items.ts`, Sprint E/F) — não duplicar lógica de resumo de item.

## A — Bugs ativos encontrados FORA de Cobranças (achados durante a auditoria ampla mandatória)

O briefing pede "ZERO RUAH NO PRODUTO ATIVO", não só em Cobranças — a auditoria (`rg`) encontrou mais 2 superfícies ativas:

| Onde | O quê | Decisão |
|---|---|---|
| `src/components/Shipment360View.tsx` (`RuahBrand`, linhas ~93-100, 232, 522) | Componente `<img src="/ruah-brand.svg" alt="RUAH Parfums"/>` usado na Central de Etiqueta (Entregas) | **Corrigido nesta sprint** — troca por um `OrganizationBrandMark` genérico (logo/nome da organização, fallback "Mugô One"), reaproveitável também em Cobranças. A linguagem visual "atelier" (cores/tipografia) é mantida — é só uma escolha de design, não é RUAH em si; só o texto/logo literal é trocado. |
| `src/components/InventoryOfferImageCard.tsx` | **Concept inteiro é perfume-específico** (ml disponível, preço por ml, "FRASCO EM ABERTO", "OPORTUNIDADE RUAH") — usado ativamente em `src/pages/InventoryPage.tsx` | **Branding corrigido nesta sprint** (troca `ruah-brand.svg`/"RUAH PARFUMS" pelo `OrganizationBrandMark` genérico). **O conceito de negócio em si (ml/frasco) fica fora de escopo** — generalizar "oferta de estoque" é uma sprint de Inventory própria (fora do título desta sprint, que é Cobrança). Documentado aqui, não escondido. |
| `src/portal/CustomerPortalRoot.tsx` | Portal do cliente inteiro ("Minha RUAH") — login/cadastro/recuperação de senha para clientes REAIS já existentes da Ruah | **Classificado C (legacy isolado), não tocado nesta sprint.** É fluxo de autenticação de clientes de verdade (não dado de teste) — reescrever copy/URLs de um fluxo de auth ativo sem uma sprint dedicada (com QA de autenticação real) é risco desproporcional ao escopo desta sprint (Cobrança). Recomendado: mover para `src/legacy/portal/` numa sprint futura de generalização de Portal do Cliente. |
| `src/enhancements.css` (comentários `"direção editorial RUAH"`, `"atelier operacional RUAH"`, classes `.ruah-brand`/`.ruah-brand-print`) | CSS que estiliza o `RuahBrand`/Central de Etiqueta | **Corrigido nesta sprint** — comentários e nomes de classe renomeados (`.org-brand-mark`), paleta/layout mantidos (é design, não é "Ruah" em si). |
| `src/App.tsx:97` — rota `/clientes/acessos-minha-ruah` → `CustomerIdentityReviewsPage` | Slug da URL cita "minha-ruah" (tela interna da equipe para revisar acessos ao portal do cliente) | **Classificado C, mesma razão do `CustomerPortalRoot.tsx`** — a tela existe para administrar o portal "Minha RUAH" citado acima; renomear a rota isoladamente sem generalizar o portal em si criaria inconsistência. Fica para a mesma sprint futura de Portal do Cliente. |

## B — Provider-specific mas tecnologia genérica (não tocar a mecânica, só a regra de negócio)

`supabase/functions/_shared/manychat.ts` (normalização de telefone, comparação em tempo constante, dedupe por chave) e `supabase/functions/manychat-send/index.ts` (mecânica de chamada HTTP ao ManyChat) continuam existindo — **não removidos**, já que ManyChat pode voltar a ser um adapter válido do Communication Hub no futuro. O que muda: **Cobranças para de chamar `sendManychatMessage` diretamente** — passa a chamar `send_communication_message` (Communication Hub, Sprint N), que decide o provider real.

## C — Já isolado corretamente (confirmado, não precisa de ação)

`src/legacy/sales/`, `src/legacy/operations/`, `src/legacy/control-tower/`, `src/legacy/spreadsheet/` — não tocados nesta sprint, continuam isolados como já estavam.

## Auditoria ampla (agente em background, escopo todo o `src`/`supabase`)

Rodei em paralelo uma auditoria mais ampla que confirmou os achados acima e encontrou **mais 20 ocorrências ativas** fora de Cobranças. Com esse volume, decisão de escopo explícita (o próprio briefing já prevê isolamento como resultado aceitável em vários pontos, e a seção "NÃO IMPLEMENTAR" exclui explicitamente IA e WhatsApp):

**Corrigidos nesta sprint** (custo baixo, risco zero, sem tocar em fluxo de autenticação de cliente real nem em infraestrutura de IA/WhatsApp):
- `src/components/AiSalesBatchImport.tsx` — texto `"Resolva o perfume no catálogo da RUAH"` → remove "da RUAH"; label `"MENSAGEM DO DAVI"` (nome de ex-funcionário) → `"MENSAGEM SUGERIDA"`.
- `src/lib/mfa-diagnostics.ts` — `console.warn('[Minha RUAH security]', ...)` → `console.warn('[MFA security]', ...)`.
- `public.log_activity`-adjacent fallback de nome `'Usuário RUAH'` em 3 funções (`202608140001_final_operational_pass.sql`, `202608190003_task_delegation.sql`, `202608230009_sale_payment_attachments.sql`) — nova migration `CREATE OR REPLACE` trocando para `'Usuário do sistema'` nas 3 (nenhuma muda assinatura, sem risco de overload).
- `docs/RUAH_HARDCODE_CATALOG.md` — linha sobre `INTERNAL_DOMAIN` está desatualizada (já foi corrigida antes); atualizado para refletir o estado real.
- `src/data/validation-report.json` — arquivo morto, não referenciado por nenhum import (`git grep` confirma) e contém dado real de cliente (`"PIX PARA MARIANA"`) — removido.

**Documentados e propositalmente NÃO tocados nesta sprint** (fora do título "Cobrança Universal", ou explicitamente excluídos por §67 do briefing, ou risco desproporcional):
- `supabase/functions/ask-intelligence`, `radar-summary`, `replenishment-summary` (prompts de IA citando "RUAH Parfums") e as RPCs `ai_authorized_aggregates`/o agregado do Radar (`data_source: "Supabase RUAH..."`) — **IA está explicitamente fora desta sprint (§67 do briefing)**.
- `supabase/functions/_shared/customer-invite.ts`, `whatsapp-customer-balance`, `customer-registration-start`, `customer-resolve-login` — templates de e-mail/WhatsApp e fluxo de cadastro do Portal do Cliente ("Minha RUAH") — **WhatsApp está explicitamente fora desta sprint (§67)**, e é o mesmo fluxo de autenticação de cliente real já classificado C acima (`CustomerPortalRoot.tsx`).
- `supabase/functions/_shared/public-app-url.ts` (domínios RUAH como allowlist de CORS) — já mitigado via `ADDITIONAL_ALLOWED_ORIGINS`; trocar os domínios fixos de fallback é uma mudança de infraestrutura de deploy, não de produto — fora de escopo.
- Prefixo `"RUAH-"` na geração de código de barras físico (`inventory_bottle_generate`, split units) — **risco real**: etiquetas físicas já impressas usam esse prefixo; mudar exige plano de migração dedicado (prefixo por organização + migração de códigos existentes), não é uma troca de string.
- `supabase/functions/_shared/manychat.ts` (alias `ruah_valor_pendente`) — compatibilidade com a configuração REAL da conta ManyChat da Ruah em produção; remover quebraria o envio atual sem confirmação com o provedor.
- Tags internas de auditoria (`'source','ruah_team'` / `'source','minha_ruah'`) — só aparecem em `metadata` de `audit_logs`, nunca renderizadas para usuário — cosmético, adiado.
- `supabase/config.toml` (`project_id`, `site_url`) — configuração de deploy/CLI, não código de produto rodando.
- Guards históricos de migração já aplicada (UUID da organização Ruah em migrations de reconciliação/arquivamento one-off) — já executados, não re-executam, mudar o arquivo não muda nada em produção; mesmo balde já aceito no `TASK_ENGINE_MIGRATION_PLAN.md`.

**Testes que travam o texto da Ruah como "correto" hoje** (`CobrancasPage.test.ts`, `CollectionSummaryImageCard.test.ts`, `ai-sales-batch-volume-gate.test.ts`) serão reescritos junto com os itens que corrigem — não fazem parte do escopo os testes que travam comportamento **deferido** acima (`manychat-whatsapp.test.ts`, `customer-recovery-email.test.ts`), que continuam corretos por descreverem código que permanece como está.

## Schema real de Cobranças (não recriar o que já existe)

- `collection_events` (organization_id, client_id, event_type **só `'message_copied'`**, created_by, metadata) — mecanismo genérico de "mensagem copiada manualmente", mantido como está.
- `collections_register_payment` — **fonte de verdade real de pagamento, já emite `payment.paid` (Sprint P) — não tocado, não substituído.**
- Nenhuma permissão `collections.*` existe ainda — hoje tudo usa `sales.view`/`sales.edit`. Novo namespace `collections.*` criado só para a NOVA superfície (settings/templates/attempts/send); `collections_register_payment` continua gated por `sales.edit` (preserva o fluxo maduro intacto, briefing §19).
- Nenhuma feature `collections` existe ainda — criada nesta sprint (`is_core=false`, mesmo padrão de `communications`/`automations`/`fiscal`).
