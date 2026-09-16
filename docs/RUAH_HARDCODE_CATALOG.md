# Catálogo de hardcodes de tenant único (RUAH)

Documento pedido pela sprint 1 de productização (item 2 — remover
hardcode de RUAH). Lista todo hardcode de tenant único identificado na
auditoria, com o que foi corrigido nesta sprint e o que fica catalogado
para uma sprint dedicada — nenhuma lógica boa foi apagada, só marcada
para virar configuração/env var/adapter quando for seguro fazer isso.

## Corrigidos nesta sprint

| Item | Local | Transformação |
|---|---|---|
| Allowlist de CORS fixa | `supabase/functions/_shared/public-app-url.ts` | `additionalAllowedOrigins()` lê `ADDITIONAL_ALLOWED_ORIGINS` (env var, origens https separadas por vírgula) e soma aos domínios da RUAH — comportamento idêntico quando a variável não está definida |
| Cópia duplicada de CORS/JSON | `supabase/functions/sale-payment-attachment-upload/index.ts` | Passou a importar `corsHeaders`/`json` de `_shared/security.ts` em vez de manter uma cópia local divergente |
| "Pegar a primeira organização do usuário" (não determinístico) | `src/lib/records.ts` (`authenticatedOrganization`) | Delega para `resolveCurrentOrganization` (`src/core/organizations/`) — preferência explícita persistida > organização única > default determinístico com aviso, nunca mais uma escolha silenciosa e sem ORDER BY |
| Constantes de configuração de organização espalhadas no código | — | Criada `organization_settings` (nome, moeda, timezone, locale, marca, `settings` jsonb livre) como destino futuro dessas constantes |

## Catalogados, não tocados nesta sprint (motivo + plano)

| Item | Local | Por que não foi tocado agora | Plano |
|---|---|---|---|
| `RUAH_ORGANIZATION_ID` | `supabase/functions/customer-registration-start/index.ts`, `supabase/functions/whatsapp-customer-balance/index.ts` | São endpoints públicos (`verify_jwt=false`) em produção real para a RUAH; a forma correta de resolver o tenant num endpoint público multi-tenant (subdomínio? path? chave por organização?) é uma decisão de produto que pertence à Fase 9 (Communication Engine) do plano de migração, não a este sprint de fundação | Decidir o mecanismo de resolução de tenant público antes de tocar; até lá, `RUAH_ORGANIZATION_ID` continua sendo o fallback funcional para a RUAH |
| `INTERNAL_DOMAIN = 'acesso.ruahparfums.com.br'` | `supabase/functions/admin-create-user/index.ts:9` | Usado para construir o e-mail interno de login (`usuario@acesso.ruahparfums.com.br`) de contas de equipe reais; mover para `organization_settings.settings` exige coordenar frontend + Edge Function + confirmar que nenhuma conta existente quebra — risco desnecessário para este sprint | Sprint dedicada de "Equipe/Auth", usando `organization_settings.settings` (já criado) como destino |
| Branding ("RUAH", "RUAH Parfums", logos) | `src/components/Sidebar.tsx:21,38-39`, `src/Auth.tsx` (`AuthLayout`), `src/App.tsx` (rodapé), `public/ruah-logo.jpg` | Sprint explicitamente proíbe mexer em layout/redesign | Fase de generalização de branding, usando `organization_settings.logo_url`/`primary_color` (já criados) |
| Domínio de e-mail de convite / templates de e-mail e WhatsApp em português com marca RUAH | `supabase/functions/_shared/customer-invite.ts` | Faz parte da generalização da Communication Engine (Fase 9), fora do escopo deste sprint | Fase 9 do plano de migração |
| Data de corte operacional (`OPERATIONAL_START_DATE`) | `src/lib/operational-sales.ts` | Já existe fallback via `organizations.operational_sales_start_date`; o valor hardcoded só é usado quando a coluna está null — baixo risco, mas tocar exige revisar todos os call sites (`records.ts` linhas 68/255/312/372) | Pequena, mas não essencial para este sprint — candidata a próxima sprint |
| Vocabulário/prompts de IA em português/perfume | `supabase/functions/ask-intelligence`, `radar-summary`, `replenishment-summary` | Generalização de IA está fora do escopo explícito desta sprint | Fase 10 do plano de migração |
| Chaves nomeadas por pessoa (`davi`, `gabriel`) na resposta do Control Tower | `src/lib/control-tower.ts`, `src/pages/ControlTowerPage.tsx` | Exige mudança coordenada de RPC + frontend; Tasks/Kanban é sprint futura, não esta | Sprint de Tasks (Fase 5 do plano de migração) |
| Data de corte / mapeamento fixo de colunas do import (`CLIENTE`, `PERFUME`, `TIPO`, `ML`, `VALOR`) | `src/lib/importer.ts` | Generalização do Import Engine é item explícito de fase futura (Fase 2/6), não desta sprint de fundação | Import Engine genérico |

## Princípio aplicado

Em todos os itens "catalogados, não tocados": a lógica não foi apagada
nem contornada — só documentada, para que a próxima sprint que tocar
aquele domínio já saiba exatamente onde está o hardcode e qual é o
destino recomendado (config de organização, env var, adapter isolado ou
metadata), em vez de precisar re-auditar o código do zero.
