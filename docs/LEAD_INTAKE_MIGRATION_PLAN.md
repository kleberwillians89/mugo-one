# Plano de migração — Lead Intake + Touchpoints (Sprint M)

Auditoria do schema real (staging), antes de qualquer migration nova.

## 1. O que já existe e será reaproveitado (não duplicar)

| Campo/função | Onde | Reaproveitamento nesta sprint |
|---|---|---|
| `clients.normalized_email/normalized_phone/normalized_whatsapp/normalized_cpf` + índices em `(organization_id, normalized_*)` | `clients` | Identity resolution de **customer** usa estas colunas/índices diretamente — não recria nada |
| `leads.source/source_channel/source_medium/source_campaign/source_external_id/attribution_metadata` | `leads` | `lead_intake_events` usa o mesmo vocabulário (`source`/`medium`/`campaign`), e ao criar um Lead a partir de um intake, esses campos são copiados 1:1 |
| `leads.company_id/contact_id/customer_id` | `leads` | Vínculo Customer/Contact/Company de um Lead já existe — Lead Intake só precisa preencher `customer_id` quando a resolução de identidade achar um customer existente; Contact/Company continuam resolvidos em `convert_lead()` (já construído na Sprint 3), não duplicado aqui |
| `normalize_br_phone(text)` | função SQL | Reaproveitada tal como está (`55DDDNNNNNNNNN`, sem inventar DDD) — não recriada |
| `normalize_person_name(text)` | função SQL | Reaproveitada para comparação de nome (nunca para merge automático, só para exibição/candidatos) |
| `only_digits(text)` | função SQL | Reaproveitada para normalizar documento (CPF/CNPJ) |
| `entity_belongs_to_organization()` | função SQL | Ganha o case `'touchpoint'` não é necessário (touchpoint não é alvo de tag/custom field nesta sprint) — mas os cases `customer/company/contact/lead` já existentes são reaproveitados para validar a entidade relacionada do touchpoint |
| `clients.merged_into_id` | `clients` | Confirma que já existe um mecanismo de merge revisável — Lead Intake nunca mescla sozinho, só sinaliza conflito (§14/§15 do briefing), consistente com o que já existe |
| `convert_lead()` RPC | Sprint 3 | Continua sendo o único lugar que cria/vincula Company/Contact a partir de um Lead — Lead Intake NÃO duplica essa lógica, só cria/reaproveita o Lead |

## 2. O que está ausente

- `leads` não tem `normalized_email`/`normalized_phone` próprios (usa `email`/`phone` crus; `convert_lead()` normaliza na hora, via `normalize_person_name`/`normalize_br_phone` aplicados inline). Lead Intake segue o mesmo padrão: normaliza na leitura/escrita, sem adicionar colunas novas a `leads` nesta sprint — evita alterar uma tabela já estável para um ganho que dedupe por índice parcial resolveria igual (ver §Identity storage abaixo).
- Nenhuma tabela de evento de entrada externa (`lead_intake_events`) — nova.
- Nenhuma tabela de touchpoint — nova.
- Nenhum conceito de endpoint público por organização — novo.
- `catalog_items` já existe (Fase E) e serve como `interest_catalog_item_id` opcional sem nenhuma alteração.

## 3. Regras de dedupe atuais (para não reinventar/conflitar)

`convert_lead()` já implementa dedupe conservador na conversão Lead→Customer: match exato por email OU phone normalizado, nunca por nome sozinho; `count(*) > 1` gera `lead_customer_match_ambiguous` (recusa, não escolhe). Lead Intake replica o MESMO princípio uma etapa antes (na entrada, não na conversão): nunca merge por nome/empresa parecidos, nunca fuzzy, nunca IA.

## 4. Decisão: identity storage — colunas normalizadas vs. `entity_identities`

Avaliado per §58 do briefing. **Decisão: não criar `entity_identities`.** Motivo: `clients` já tem as quatro colunas normalizadas indexadas que cobrem 100% dos casos de identity resolution desta sprint (email/phone/whatsapp/cpf); `leads` normaliza na leitura (mesmo padrão do `convert_lead()` já em produção). Uma tabela de identidades polimórfica resolveria o mesmo problema com uma camada de indireção a mais, sem nenhum caso de uso concreto que as colunas diretas não resolvam hoje. Se um provider trouxer um tipo de identificador novo (ex.: `external_id` de um CRM terceiro por pessoa, não por evento) e isso se repetir em volume, reavaliar nesse momento — não antes.

## 5. RLS/constraints existentes relevantes

`clients`/`leads`/`companies`/`contacts` já são `organization_id`-scoped com RLS por `has_org_permission`/`has_org_role`. Lead Intake segue o MESMO padrão para as tabelas novas — a única exceção é a função pública de entrada (`lead_intake_submit`), que precisa ser executável por `anon` (sem sessão), então NUNCA confia em `organization_id` vindo do payload — sempre resolve a organização a partir da `public_key` validada dentro da própria função (ver docs/LEAD_INTAKE_API.md).

## 6. Indexes planejados

`organization_id`, `normalized_email`/`normalized_phone`/`normalized_document` (nas tabelas novas, mesmo padrão parcial de `clients`), `(provider, external_id)` único por organização, `idempotency_key` único por organização, `occurred_at`, `processing_status` — detalhados nas migrations (§56 do briefing).

## 7. `deals` — auditoria adicional

`deals` já tem o MESMO vocabulário de atribuição que `leads` (`source`, `source_channel`, `source_medium`, `source_campaign`, `source_external_id`, `attribution_metadata` jsonb). Confirma que o vocabulário `source/medium/campaign` já é um padrão estabelecido em 3 tabelas (`clients`, `leads`, `deals`) — `lead_intake_events`/`touchpoints` adotam exatamente os mesmos nomes de campo, sem inventar sinônimos novos.

## 8. Decisão: Edge Function vs. RPC pública (§23/§24)

Avaliado com base no que já existe em `supabase/functions/`. **Decisão: Edge Function**, não uma RPC `SECURITY DEFINER` liberada para `anon`. Motivo: o projeto já tem um padrão maduro e comprovado para entrada pública (`customer-registration-start`, `customer-claim-start`, `manychat-send`), com:
- `_shared/security.ts` → `corsHeaders()`/`json()` (CORS restrito a origens permitidas via `isAllowedPublicOrigin`/`allowedPublicOrigins`, nunca `*` sem motivo);
- `_shared/public-rate-limit.ts` → `publicRateLimit()`, que chama a RPC **já existente** `consume_public_endpoint_rate_limit(p_scope, p_key_hash, p_limit, p_window_seconds)` — resolve §25 (rate limit) sem construir nada novo, só um novo `scope` (`lead-intake.ip` / `lead-intake.key`);
- `service_role` só é usado dentro da função (Deno.env), nunca exposto — resolve §38 automaticamente pelo próprio formato (Edge Function não roda no bundle do frontend);
- convenção de log já estabelecida: mascarar PII antes de `console.log` (ex.: `maskedEmail()`), reaproveitada tal como está para resolver §47/§72.

Uma RPC `anon`-grantable exigiria reconstruir CORS, rate-limit e mascaramento de log do zero dentro do Postgres — sem ganho, e fugindo do padrão já testado em produção. A Edge Function nova (`lead-intake`) recebe `public_key` como segmento de path (`/functions/v1/lead-intake/:public_key`), resolve a organização consultando `lead_intake_endpoints` via client `service_role`, e delega a normalização/resolução de identidade/idempotência para uma RPC `SECURITY DEFINER` interna (`lead_intake_submit`, chamada só pela função com o client admin — nunca liberada para `anon`/`authenticated` diretamente).

## 9. Decisão: como a `public_key` é armazenada

Diferente de uma senha, a `public_key` precisa ser **exibida** para o usuário colar em Zapier/Make/n8n/site/ManyChat — não faz sentido armazenar só hash (o dono do endpoint precisa poder ver a chave de novo, inclusive depois de fechar a tela, ex. pra reconfigurar um webhook). Decisão: armazenar em texto pleno em `lead_intake_endpoints.public_key`, protegida por: alta entropia (32 bytes aleatórios, hex), RLS (só membros da organização com permissão de leitura veem a linha), rotação/revogação a qualquer momento, e nunca aparecendo em log completo (mascarada como `abcd…wxyz` em `audit_logs`/`activities`, resolvendo §48). Isso segue o mesmo modelo que webhooks de Stripe/Zapier usam (a URL/token É o segredo, visível no painel, protegido por entropia + revogação, não por hashing).

`consume_public_endpoint_rate_limit` exige `auth.role() = 'service_role'` — só é chamável de dentro de uma Edge Function com o client admin, reforçando que a Edge Function (não uma RPC anon-grantable) é o único caminho viável para reaproveitá-la.

## 10. `entity_belongs_to_organization` / `activities.entity_type` — não precisam de novo case

`entity_belongs_to_organization` hoje cobre: `customer, company, contact, lead, deal, sale, catalog_item, task`. Touchpoints referenciam `entity_type/entity_id` desse mesmo conjunto (customer/company/contact/lead nesta sprint, por §8 do briefing) — reaproveitado sem alteração. `activities.entity_type` tem o MESMO conjunto de 8 valores. Como `lead_intake_event`/`touchpoint` nunca são, eles próprios, o assunto de uma activity (a activity é sempre logada contra o `lead`/`customer` afetado, via `log_activity` que já valida por `entity_belongs_to_organization`), **nenhuma das duas constraints precisa ser alterada nesta sprint** — diferente da Fase E/F e da Task Engine, aqui o padrão de reuso evita o bug recorrente por design, não por correção reativa.

## 11. Importer existente (§41)

`process-import`/`confirm-import`/`revert-import` (Edge Functions) + `src/lib/importer.ts` já formam um Import Engine em produção (CSV → preview → confirmação). Não duplicado nesta sprint. Documentado como consumidor futuro: o Import Engine poderá gerar `lead_intake_events` (`provider='csv_import'`, `channel='import'`) reaproveitando a MESMA função de normalização/identity-resolution desta sprint, em vez de inserir direto em `leads` — mudança de uma linha de "destino", não desta sprint.
