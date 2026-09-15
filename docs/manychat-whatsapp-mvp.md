# ManyChat + WhatsApp — configuração do MVP

## Secrets das Edge Functions

- `MANYCHAT_API_KEY`: Account Public API Key de **Settings → API**.
- `MANYCHAT_COLLECTION_FLOW_ID`: `flow_ns` da automação de cobrança.
- `MANYCHAT_ACCESS_FLOW_ID`: `flow_ns` da automação de ativação.
- `MANYCHAT_RUAH_WEBHOOK_SECRET`: segredo exclusivo criado para ManyChat → RUAH.
- `RUAH_ORGANIZATION_ID`: organização RUAH usada na consulta server-to-server.

Não colocar valores desses secrets no frontend ou no corpo da automação.

O `flow_ns` pode ser obtido na URL quando a automação está aberta ou pelo endpoint oficial `GET /fb/page/getFlows`.

## CRM → ManyChat

O frontend autenticado chama `manychat-send`:

```json
{"client_id":"UUID","message_type":"collection"}
```

ou:

```json
{"client_id":"UUID","message_type":"access"}
```

O backend obtém nome e telefone no CRM, valida unicidade, procura/cria o contato e, para cobrança, recalcula no banco o total das vendas selecionadas. Antes de iniciar a automação, resolve os IDs dos Custom User Fields existentes com `GET /fb/page/getCustomFields` e atualiza o contato com `POST /fb/subscriber/setCustomFields`. Somente depois de uma resposta de sucesso chama `POST /fb/sending/sendFlow`.

Campos esperados no ManyChat:

- `nome_cliente` — Text;
- `numero_pedido` — Text (uma venda usa seu UUID; cobranças agrupadas usam os UUIDs separados por vírgula);
- `valor_pedido` — Number. Por compatibilidade, o nome anterior `ruah_valor_pendente` também é reconhecido, desde que seja Number;
- `imagem_cobranca_url` — Text, opcional.

Os IDs são descobertos pela API; não existem IDs de Custom User Fields gravados no código. Se um dos três campos obrigatórios estiver ausente ou se o campo de valor não for Number, o flow não é disparado.

A imagem usa o mesmo card de cobrança da tela, é salva no bucket privado `collection-images` e enviada como URL assinada por sete dias. A chave do ManyChat e a chave de serviço do Supabase permanecem somente nas Edge Functions.

## ManyChat → CRM: Ver valor do pedido

- URL: `https://pfhvqkzafgoyumxmbwqc.supabase.co/functions/v1/whatsapp-customer-balance`
- Método: `POST`
- Headers:
  - `Content-Type: application/json`
  - `x-ruah-webhook-secret: <MANYCHAT_RUAH_WEBHOOK_SECRET>`
- Body:

```json
{"phone":"<insira aqui a variável de sistema WhatsApp ID>"}
```

No editor do ManyChat, selecione a variável pela interface: **System Fields → WhatsApp ID**. Não digite manualmente um nome presumido para a variável.

Mapeie a resposta para um Custom User Field de texto chamado `ruah_valor_pendente` usando o JSON Path:

```text
$.total_formatted
```

Resposta de exemplo:

```json
{"ok":true,"customer_name":"Larissa","open_orders":36,"total_pending":12323.3,"total_formatted":"R$ 12.323,30"}
```

Depois adicione uma mensagem WhatsApp:

```text
O valor total dos seus pedidos em aberto é:

💰 {{ruah_valor_pendente}}

Se quiser pagar no cartão, me fala em quantas vezes prefere parcelar. 🤍
```

## Automação de cobrança

1. Abra/crie a automação apontada por `MANYCHAT_COLLECTION_FLOW_ID`.
2. O primeiro nó deve ser o template de cobrança aprovado, para funcionar fora da janela de 24 horas.
3. Conecte o botão **Ver valor do pedido** a um bloco de ação.
4. Adicione **Make External Request** com a URL, headers e body acima.
5. Na aba de resposta, mapeie `$.total_formatted` para `ruah_valor_pendente`.
6. Conecte o sucesso à mensagem que usa `{{ruah_valor_pendente}}`.
7. Adicione uma resposta genérica de indisponibilidade na saída de erro.
8. Publique a automação somente depois do teste com o contato interno.

## Automação de ativação

1. Abra/crie a automação apontada por `MANYCHAT_ACCESS_FLOW_ID`.
2. Use o template de ativação aprovado como primeiro nó.
3. Configure o botão/link para `https://crm.ruahparfums.com.br/minha-ruah/cadastro`.
4. Publique somente depois do teste interno.

## Fontes oficiais consultadas

- https://api.manychat.com/swagger
- https://help.manychat.com/hc/en-us/articles/14281353475228-How-to-create-WhatsApp-contacts-via-Manychat-API
- https://help.manychat.com/hc/en-us/articles/14959510331420-How-to-generate-a-token-for-the-Manychat-API-and-where-to-get-parameters
- https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request
- https://help.manychat.com/hc/en-us/articles/14281292522652-System-Fields
