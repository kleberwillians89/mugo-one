# SuperFrete — operação em produção

## Arquitetura

O navegador nunca recebe o token:

```text
CRM autenticado → Supabase Edge Function → API SuperFrete
```

Secrets obrigatórios: `SUPERFRETE_TOKEN`, `SUPERFRETE_BASE_URL` e `SUPERFRETE_USER_AGENT`. Seus valores não podem aparecer em logs, banco, frontend ou Git.

## Configuração inicial

Em **Configurações → SuperFrete — Produção**, um administrador ou gestor preenche o remetente real e o pacote padrão. Peso e dimensões são defaults editáveis; o sistema não estima peso a partir de ML.

Antes da primeira emissão, confirme nome, documento, e-mail, telefone, CEP, endereço, número, bairro, cidade e UF do remetente.

## Fluxo operacional

1. Uma venda operacional paga reserva estoque.
2. No Cliente 360°, selecione uma ou várias compras do mesmo cliente.
3. Crie um único Shipment.
4. Complete o snapshot do destinatário e o pacote.
5. Use **CALCULAR FRETE**.
6. Selecione o serviço aprovado pelo cliente.
7. Confirme **APROVADO PELO CLIENTE**.
8. Revise o resumo final e use **APROVADO PELO CLIENTE — EMITIR ETIQUETA**.
9. Somente essa última ação pode executar `/cart` e `/checkout` com saldo real.

Cotação, carrinho, checkout e etiqueta liberada não baixam estoque físico. A baixa acontece somente quando a sincronização confirma `posted`.

## Campos incompletos

A cotação exige CEPs e pacote. A emissão também exige os dados completos do remetente e destinatário. Quando o destinatário estiver incompleto, use **Completar dados do cliente** e depois **Atualizar do Cliente 360°** no Shipment.

## Idempotência e reconciliação

- O Shipment possui uma única chave persistida para criação de carrinho.
- Se `superfrete_order_id` existe, `/cart` não é repetido.
- O checkout possui outra chave idempotente persistida.
- Duplo clique e requisições concorrentes devolvem o estado já iniciado.
- Timeout gera `cart_uncertain` ou `checkout_uncertain`.
- Estados incertos nunca são repetidos automaticamente. Use **Sincronizar status**.

## Rastreamento e impressão

Após liberação, use **Sincronizar status**, **Copiar rastreio** e **Imprimir etiqueta**. Estados externos são convertidos no backend; strings da SuperFrete não controlam diretamente a interface.

## Testes seguros

```bash
npm test
npm run test:superfrete-safety
npm run test:superfrete-remote
npm run test:superfrete-quote-production
```

O teste remoto normal usa respostas simuladas. O teste de produção chama exclusivamente `/api/v0/calculator`. Nenhum teste chama `/cart` ou `/checkout`.

O primeiro carrinho e checkout reais devem ser feitos pelo Davi no CRM após a conferência visual do cliente, endereço, serviço, preço, peso e dimensões.
