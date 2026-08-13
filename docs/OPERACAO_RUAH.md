# Operação RUAH — Fundação operacional

> A emissão logística em produção está documentada em [SUPERFRETE.md](./SUPERFRETE.md). A compra real de etiqueta depende sempre do botão humano de confirmação.

## Regra central

Venda, pagamento e envio são estados independentes. Uma venda paga transfere a disponibilidade comercial do produto para o cliente, mas não produz um envio e não reduz novamente o estoque quando um Shipment é preparado.

Fluxo da Fase 1:

1. `pending`: sem alocação definitiva.
2. `paid`: cria `inventory_allocations.reserved` em transação com lock do item.
3. Shipment em preparação: a alocação passa para `shipping` e várias compras podem integrar o mesmo Shipment.
4. Cancelamento do Shipment antes da postagem: volta para `reserved`.
5. Postagem: baixa `physical_ml` uma vez e passa a alocação para `shipped`.
6. Cancelamento/estorno antes do envio: libera a reserva e devolve `available_ml`.

## Compatibilidade histórica

Os campos `shipping_deadline_*`, `shipping_operational_status` e `shipped_at` permanecem em `sales`. Eles são históricos e não definem o novo fluxo.

A reconciliação automática só reconstrói alocações quando existe um movimento negativo vinculado inequivocamente à venda. Vendas pagas sem essa evidência não alteram saldo: o perfume recebe `reconciliation_status=review_required`.

Nenhuma migration anterior é alterada e nenhum movimento histórico é apagado. Todas as vendas existentes recebem implicitamente `inventory_allocation_eligible=false`; a migration não cria alocação histórica. Somente o novo formulário operacional grava `true`.

## Cliente 360°

A rota `/clientes/:id` reúne cadastro, resumo comercial, produtos aguardando envio, compras completas e Shipments. O endereço do cliente pode ser atualizado, mas cada Shipment mantém seu snapshot imutável de destinatário.

## Planilha incremental

Use apenas em dry-run:

```bash
npm run analyze:incremental -- "/caminho/arquivo.xlsx"
```

Sem um snapshot autenticado de assinaturas do Supabase, `new_rows` e `existing_rows` ficam `null`. `candidate_rows` não significa linha nova. Com um snapshot revisado:

```bash
npm run analyze:incremental -- "/caminho/arquivo.xlsx" snapshot-assinaturas.json
```

O snapshot deve conter `{ "signatures": ["sha256..."] }`. A assinatura não inclui o nome do arquivo, permitindo reconhecer a mesma venda em planilhas diferentes. Nenhuma carga é realizada por esse comando.

## Aplicação segura da migration

Antes de aplicar `202608130001_operational_foundation.sql`:

1. gerar backup e relatório de `inventory_items` e `inventory_movements`;
2. contar vendas manuais pagas, pendentes e canceladas com movimentos;
3. executar em ambiente de homologação;
4. validar `physical_ml = available_ml + reserved_ml + shipping_ml` nos itens reconciliados;
5. revisar todos os itens `review_required`;
6. testar transições `pending → paid → cancelled`;
7. somente então promover para produção.

Não criar alocações retroativas por inferência baseada apenas em `payment_status`.
