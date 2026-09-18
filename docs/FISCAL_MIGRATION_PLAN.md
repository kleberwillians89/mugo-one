# Plano de migração — Fiscal Foundation + Nuvem Fiscal + NFS-e (Sprint P)

Auditoria de pagamentos/fiscal no código+banco reais, e da API do provider, antes de qualquer migration nova.

## 0. Achado crítico: Nuvem Fiscal está desativada

Auditoria obrigatória do §2 do briefing (consultar documentação oficial e atual) encontrou: a Nuvem Fiscal **anunciou desativação do serviço em 22/04/2026** ("Comunicado de Desativação do Serviço Nuvem Fiscal"), com desligamento em **31/07/2026** — já ocorrido há ~7 semanas na data desta sprint (2026-09-18). Confirmado por duas buscas independentes (incluindo o comunicado oficial da própria empresa) e por falha de resolução DNS de `nuvemfiscal.com.br` e `dev.nuvemfiscal.com.br` (o domínio não existe mais). Não há mais sandbox nem produção para integrar de verdade.

**Decisão (confirmada com o usuário via pergunta direta, não assumida sozinha)**: construir o Fiscal Core inteiro agnóstico de provider normalmente, e implementar `NuvemFiscalAdapter` mesmo assim como adapter de **referência** — usando o que pôde ser confirmado da API antes do desligamento (autenticação OAuth2 `client_credentials`, Bearer token, `scope=nfse` obrigatório para chamadas de NFS-e, exigência de cadastro prévio de empresa + certificado digital) — mas **nunca testado ponta a ponta** (provider morto). Marcado em todo lugar relevante como `PROVIDER E2E NOT TESTED` (briefing §81), nunca fingindo sucesso. A Focus NFe (já citada no próprio briefing §65 como um provider futuro, e recomendada pela própria Nuvem Fiscal como alternativa de mercado) é a candidata natural para o adapter real de uma sprint futura — arquitetura pronta para isso sem alterar o Core.

O que PÔDE ser confirmado sobre a API da Nuvem Fiscal antes do domínio parar de responder (via cache de busca, não fetch direto):
- Autenticação: OAuth2, fluxo `client_credentials`, header `Authorization: Bearer <token>`.
- `client_id`/`client_secret` obtidos no console da própria plataforma (nunca no Mugô One).
- Chamadas de NFS-e exigem um token com `scope=nfse`.
- Emissão de NFS-e exige cadastro prévio de: empresa, certificado digital, configurações municipais — antes de qualquer emissão.
- Estrutura de docs sugeria recursos separados por documento (`/nfse`, autenticação própria, seção "serviços").

O que **não** pôde ser confirmado (docs inacessíveis): paths exatos de endpoint, schema exato de request/response, formato exato de erro, existência/formato de webhook. `NuvemFiscalAdapter` implementa a troca de token (padrão confirmado) e a INTERFACE completa do `FiscalProvider`, mas os métodos que fariam a chamada real de emissão retornam `PROVIDER_NOT_VERIFIED` de forma explícita e documentada, em vez de inventar um payload que nunca foi confirmado contra a documentação real.

## 1. Auditoria de pagamentos — existe fonte de verdade segura

**Não existe uma tabela `payments` separada.** Pagamento é um conjunto de colunas em `sales`: `payment_status` (enum `paid|pending|cancelled|unknown`), `payment_method`, `paid_at`, mais campos de reconciliação histórica (`original_payment_status`, `original_payment_method` — bagagem de migração de dados antigos, não usar).

**Fonte de verdade real e segura encontrada**: `collections_register_payment(p_sale_ids uuid[], p_paid_at date, p_payment_method text, p_notes text)` — RPC atual (módulo Cobranças), tenant-safe (`current_user_org_ids()` + `has_org_permission('sales.edit')`), já com proteção contra dupla-execução (se a venda já está `paid` com os MESMOS `paid_at`/`payment_method`, é adicionada a `skipped_ids` e pulada silenciosamente; se está paga com dados DIFERENTES, levanta `sale_already_paid`) e grava `audit_logs`. **Esta é a única transição seguravelmente atômica de pending→paid encontrada** — as demais funções que tocam `payment_status` (`apply_general_sales_reconciliation`, `rollback_approved_historical_payments`, `apply_davi_safe_diagnostic_batch`, etc.) são ferramentas de reconciliação/migração de dados históricos, não operações de domínio do dia a dia, e não devem virar fonte de emissão de evento.

**Decisão**: `payment.paid` **é implementado nesta sprint**, emitido de dentro de `collections_register_payment`, só para as vendas que de fato mudaram (`changed_ids`, nunca para as `skipped_ids` — evita duplicar o evento numa nova tentativa idêntica). `payment.created`/`payment.failed`/`payment.cancelled` **não têm operação de domínio clara equivalente** nesta sprint (não existe um "criar cobrança" nem um "marcar como falha" com o mesmo nível de segurança) — documentados como gap, não implementados, seguindo a mesma regra já aplicada a `deal.created` na Sprint O.

## 2. Campos fiscais já reutilizáveis (não duplicar)

| Onde | Campos | Uso no Fiscal |
|---|---|---|
| `organization_settings` | `legal_name`, `company_name`, `document`, `email`, `phone`, `country` | `organization_fiscal_profiles` referencia esses 3 (legal_name/company_name/document) em vez de duplicar — só acrescenta o que é genuinamente fiscal (inscrição estadual/municipal, regime tributário, endereço, city_code, flags nfse/nfe/nfce) |
| `clients` | `cnpj`, `cpf`, `normalized_cpf`, `address_line`, `address_number`, `district`, `city`, `state`, `postal_code`, `normalized_postal_code` | Base do `recipient_snapshot` quando o tomador é uma Customer |
| `companies` | `document`, `address_line`, `address_number`, `district`, `city`, `state`, `postal_code` | Base do `recipient_snapshot` quando o tomador é uma Company |
| `catalog_items` | `type` (`product`\|`service`), `unit` | UI pode SUGERIR NFS-e quando `type='service'`, nunca decide sozinha (briefing §17) |

## 3. `entity_belongs_to_organization` — não precisa de novo case

`fiscal_documents`/`fiscal_connections`/`organization_fiscal_profiles` não são, elas mesmas, alvo de `log_activity`/touchpoint por um `entity_type` novo — activities fiscais são logadas contra `'sale'` (já suportado). Domain events fiscais usam `entity_type='sale'`, `entity_id=sale_id` — reaproveitado sem alteração.

## 4. Feature flag e permissões

`fiscal` já existe (`is_core=false`, seedada especulativamente numa sprint anterior — não recriada). Permissões novas: `fiscal.view/issue/cancel/manage` (sem permissão por tipo de documento, briefing §29).

## 5. Numeração de migrations

Última migration existente: `202609250014`. Esta sprint usa `202609260001` em diante.
