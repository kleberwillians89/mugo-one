# Análise separada: venda paga sem item de estoque

Status: diagnóstico aberto; nenhuma correção incluída na migration de reconciliação histórica.

## Fragilidade observada

A versão atual de `public.sync_sale_inventory_allocation()` procura um `inventory_items` ativo para o perfume e retorna `NEW` quando não encontra item ou quando a venda antecede `reference_date`. Para uma venda operacional com `inventory_allocation_eligible=true` e `payment_status='paid'`, isso permite que o pagamento seja persistido sem reserva correspondente.

No dry-run de 03/09/2026, 28 das 129 vendas ativas remanescentes não encontraram item aplicável. Elas continuam `pending` e estão fora da allowlist da reconciliação histórica.

## Correção futura proposta — não implementada

Em migration separada, alterar somente o ramo elegível/pago da função para distinguir:

- venda inelegível (`inventory_allocation_eligible=false`): retornar sem alocação, preservando importações históricas;
- venda elegível/paga sem item ativo: lançar erro explícito, por exemplo `inventory_item_required_for_eligible_paid_sale`;
- venda elegível/paga anterior a `reference_date`: definir e testar uma política própria, sem confundir esse caso com item inexistente.

Antes dessa alteração serão necessários testes de regressão para criação/edição normal, reconciliação histórica inelegível, vendas anteriores à referência e concorrência sobre o item.
