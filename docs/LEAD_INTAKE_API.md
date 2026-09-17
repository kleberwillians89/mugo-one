# API de Entrada de Leads (Lead Intake)

Porta de entrada pública e universal para leads vindos de site, formulário, webhook, automação (Zapier/Make/n8n) ou API própria — sem depender de integração nativa com Meta/Google/WhatsApp.

## Endpoint

```
POST https://otresxebmpfwqwawdsxh.supabase.co/functions/v1/lead-intake/{public_key}
Content-Type: application/json
```

`{public_key}` é gerado por organização em **Configurações → Entradas de Leads** (nunca reutilize a mesma chave entre integrações que você queira poder desativar independentemente — crie um endpoint por integração).

Não é preciso enviar `Authorization`/`apikey` — a própria `public_key` no caminho é a credencial. CORS é aberto (`*`) neste endpoint especificamente, para permitir POST tanto de servidor-a-servidor quanto de JS rodando no site do cliente.

## Payload

Todos os campos são opcionais exceto indicado. Campos desconhecidos não quebram a chamada — vão para `metadata`.

| Campo | Tipo | Observação |
|---|---|---|
| `provider` | string | quem entregou o dado (`generic_webhook`, `manychat`, etc.) — default `generic_webhook` |
| `channel` | string | canal de origem (`website`, `form`, `meta_ads`, `whatsapp`, `referral`, ...) — default `website` |
| `external_id` | string | id do evento na origem — usado para idempotência |
| `idempotency_key` | string | alternativa a `external_id` para idempotência |
| `name`, `email`, `phone` | string | **ao menos um dos três é obrigatório** |
| `document` | string | CPF/CNPJ, nunca obrigatório |
| `company_name` | string | |
| `interest_catalog_item_id` | uuid | precisa pertencer à mesma organização da `public_key` |
| `interest` | string | interesse em texto livre (alternativa a `interest_catalog_item_id`) |
| `source`, `medium` | string | |
| `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`, `ad_name` | string | |
| `form_id`, `form_name`, `landing_page`, `referrer` | string | |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | string | |
| `click_id`, `click_id_type` | string | ex.: `click_id_type: "gclid"` |
| `occurred_at` | string (ISO 8601) | quando o evento realmente aconteceu na origem; default = agora |
| `metadata` | object | qualquer dado adicional controlado |

## Exemplo (copiar/colar)

```json
{
  "provider": "generic_webhook",
  "channel": "website",
  "external_id": "form-submission-12345",
  "name": "Maria Exemplo",
  "email": "maria@exemplo.com",
  "phone": "11999998888",
  "interest": "Gestão de Tráfego",
  "channel_detail": "formulário de contato",
  "utm_source": "google",
  "utm_campaign": "institucional-2026"
}
```

```bash
curl -X POST https://otresxebmpfwqwawdsxh.supabase.co/functions/v1/lead-intake/SUA_CHAVE_AQUI \
  -H "content-type: application/json" \
  -d '{"provider":"generic_webhook","channel":"website","name":"Maria Exemplo","email":"maria@exemplo.com","interest":"Gestão de Tráfego"}'
```

## Idempotência

Reenviar o mesmo `external_id` (ou `idempotency_key`) para a mesma organização nunca cria um segundo Lead/touchpoint — a resposta volta com `"status":"duplicate"` e os mesmos `event_id`/`lead_id` da primeira vez. Use isso para reprocessar webhooks com segurança (retries de rede, at-least-once delivery).

## Identidade e deduplicação

A pessoa/empresa é uma só. Se e-mail, telefone ou documento normalizado já baterem com exatamente um Customer existente na organização, o Lead novo nasce vinculado a esse Customer (`customer_id`) — nunca cria um Customer duplicado. Se identificadores diferentes apontarem para Customers diferentes (ex.: e-mail de uma pessoa, telefone de outra), a entrada fica marcada como `identity_conflict` para revisão manual — o sistema nunca escolhe sozinho nem funde identidades.

## Respostas

```json
{ "data": { "status": "processed", "event_id": "...", "lead_id": "...", "customer_id": null } }
```

| `status` | HTTP | Significado |
|---|---|---|
| `processed` | 200 | Lead criado (e vinculado a um Customer existente, se resolvido) |
| `duplicate` | 200 | Mesmo evento já processado antes — nada foi criado de novo |
| `identity_conflict` | 202 | Identificadores conflitantes — registrado para revisão, nenhum Lead criado |
| `invalid_payload` | 400 | Payload inválido (ver `error_code`) |
| `invalid_key`/`endpoint_disabled` | 401/403 | Chave inválida ou endpoint desativado |
| `rate_limit` | 429 | Muitas requisições — respeite os limites (120/h por IP, 600/h por chave) |
| `failed` | 500 | Erro inesperado no processamento — o evento fica registrado como `failed`, não desaparece |

Códigos de erro: `INVALID_PAYLOAD`, `ENDPOINT_DISABLED`, `INVALID_INTAKE_KEY`, `IDENTITY_CONFLICT`, `TENANT_MISMATCH`, `PROCESSING_ERROR`.

## Fora do escopo (por enquanto)

Nenhuma credencial de verdade aparece neste documento. Integrações nativas com Meta Lead Ads, Google Ads API e WhatsApp Business API ainda não existem — o adaptador genérico (`generic_webhook`) já permite alimentar o Mugô One hoje via site, Zapier, Make, n8n, ManyChat ou backend próprio, sem depender delas.
